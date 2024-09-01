//@ts-nocheck
"use client";
import React, { useState, useEffect, useRef } from "react";
import Head from "next/head";
import Script from "next/script";
import styles from "./PipecatWebSocketClient.module.css";

const SAMPLE_RATE = 16000;
const NUM_CHANNELS = 1;
const PLAY_TIME_RESET_THRESHOLD_MS = 1.0;

export default function PipecatWebSocketClient() {
  const [isLoading, setIsLoading] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isWebSocketReady, setIsWebSocketReady] = useState(false);
  const [Frame, setFrame] = useState(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const sourceRef = useRef(null);
  const microphoneStreamRef = useRef(null);
  const scriptProcessorRef = useRef(null);
  const analyserRef = useRef(null);
  const playTimeRef = useRef(0);
  const lastMessageTimeRef = useRef(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      window.protobuf.load("/frames.proto", (err, root) => {
        if (err) {
          console.error("Error loading protobuf:", err);
          throw err;
        }
        setFrame(root.lookupType("pipecat.Frame"));
        setIsLoading(false);
      });
    }
  }, []);

  const initWebSocket = () => {
    wsRef.current = new WebSocket(
      "https://fuzzy-space-guide-r5646xqvwpqcpqpx-8765.app.github.dev/"
    );
    wsRef.current.addEventListener("open", () => {
      console.log("WebSocket connection established.");
      setIsWebSocketReady(true);
    });
    wsRef.current.addEventListener("message", handleWebSocketMessage);
    wsRef.current.addEventListener("close", (event) => {
      console.log("WebSocket connection closed.", event.code, event.reason);
      setIsWebSocketReady(false);
      stopAudio(false);
    });
    wsRef.current.addEventListener("error", (event) => {
      console.error("WebSocket error:", event);
      setIsWebSocketReady(false);
    });
  };

  const handleWebSocketMessage = async (event) => {
    const arrayBuffer = await event.data.arrayBuffer();
    enqueueAudioFromProto(arrayBuffer);
  };

  const enqueueAudioFromProto = (arrayBuffer) => {
    const parsedFrame = Frame.decode(new Uint8Array(arrayBuffer));
    if (!parsedFrame?.audio) return false;

    const diffTime =
      audioContextRef.current.currentTime - lastMessageTimeRef.current;
    if (playTimeRef.current == 0 || diffTime > PLAY_TIME_RESET_THRESHOLD_MS) {
      playTimeRef.current = audioContextRef.current.currentTime;
    }
    lastMessageTimeRef.current = audioContextRef.current.currentTime;

    const audioVector = Array.from(parsedFrame.audio.audio);
    const audioArray = new Uint8Array(audioVector);

    audioContextRef.current.decodeAudioData(
      audioArray.buffer,
      function (buffer) {
        const source = new AudioBufferSourceNode(audioContextRef.current);
        source.buffer = buffer;
        source.start(playTimeRef.current);
        source.connect(audioContextRef.current.destination);
        playTimeRef.current = playTimeRef.current + buffer.duration;
      }
    );
  };

  const convertFloat32ToS16PCM = (float32Array) => {
    let int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      let clampedValue = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] =
        clampedValue < 0 ? clampedValue * 32768 : clampedValue * 32767;
    }
    return int16Array;
  };

  const startAudio = async () => {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      alert("getUserMedia is not supported in your browser.");
      return;
    }

    audioContextRef.current = new (window.AudioContext ||
      window.webkitAudioContext)({
      latencyHint: "interactive",
      sampleRate: SAMPLE_RATE,
    });

    setIsPlaying(true);
    initWebSocket();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: SAMPLE_RATE,
          channelCount: NUM_CHANNELS,
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      console.log("Microphone stream obtained:", stream);
      microphoneStreamRef.current = stream;
      sourceRef.current =
        audioContextRef.current.createMediaStreamSource(stream);

      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 2048;
      sourceRef.current.connect(analyserRef.current);

      scriptProcessorRef.current =
        audioContextRef.current.createScriptProcessor(512, 1, 1);
      sourceRef.current.connect(scriptProcessorRef.current);
      scriptProcessorRef.current.connect(audioContextRef.current.destination);

      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);

      scriptProcessorRef.current.onaudioprocess = (event) => {
        console.log("Audio processing event triggered");
        if (!wsRef.current || !isWebSocketReady) return;

        // Get the raw audio data from the microphone
        const audioData = event.inputBuffer.getChannelData(0);
        console.log("Raw audio data:", audioData);

        // Calculate the average of the absolute values to represent audio level
        let sum = 0.0;
        for (let i = 0; i < audioData.length; i++) {
          sum += Math.abs(audioData[i]);
        }
        const avgLevel = sum / audioData.length;

        // Scale the audio level to a percentage (0-100)
        const scaledLevel = Math.min(100, avgLevel * 20000);
        console.log("Calculated audio level:", scaledLevel);
        setAudioLevel(scaledLevel);

        const pcmS16Array = convertFloat32ToS16PCM(audioData);
        const pcmByteArray = new Uint8Array(pcmS16Array.buffer);
        const frame = Frame.create({
          audio: {
            audio: Array.from(pcmByteArray),
            sampleRate: SAMPLE_RATE,
            numChannels: NUM_CHANNELS,
          },
        });
        const encodedFrame = new Uint8Array(Frame.encode(frame).finish());
        console.log("Encoded frame:", encodedFrame);
        wsRef.current.send(encodedFrame);
        console.log("Audio frame sent, size:", encodedFrame.length, "bytes");
      };

      console.log("Audio processing set up successfully");
    } catch (error) {
      console.error("Error accessing microphone:", error);
    }
  };

  const stopAudio = (closeWebsocket) => {
    playTimeRef.current = 0;
    setIsPlaying(false);
    setIsWebSocketReady(false);
    setAudioLevel(0);

    if (wsRef.current && closeWebsocket) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect();
    }
    if (analyserRef.current) {
      analyserRef.current.disconnect();
    }
    if (microphoneStreamRef.current) {
      microphoneStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }

    console.log("Audio stopped and resources cleaned up");
  };

  return (
    <div className={styles.container}>
      <Head>
        <title>Pipecat WebSocket Client Example</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>

      <Script
        src="https://cdn.jsdelivr.net/npm/protobufjs@7.X.X/dist/protobuf.min.js"
        strategy="beforeInteractive"
      />

      <h1 className={styles.title}>Pipecat WebSocket Client Example</h1>
      <h3 className={styles.subtitle}>
        {isLoading
          ? "Loading, wait..."
          : isPlaying
          ? isWebSocketReady
            ? "Connected and streaming audio..."
            : "Connecting to WebSocket..."
          : "We are ready! Make sure to run the server and then click `Start Audio`."}
      </h3>
      <div className={styles.buttonContainer}>
        <button
          className={`${styles.button} ${styles.startButton}`}
          onClick={startAudio}
          disabled={isLoading || isPlaying}
        >
          Start Audio
        </button>
        <button
          className={`${styles.button} ${styles.stopButton}`}
          onClick={() => stopAudio(true)}
          disabled={!isPlaying}
        >
          Stop Audio
        </button>
      </div>
      <div className={styles.audioLevelContainer}>
        <div
          className={styles.audioLevelBar}
          style={{ width: `${audioLevel}%` }}
        ></div>
      </div>
    </div>
  );
}
