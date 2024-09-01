/* eslint-disable react/no-unescaped-entities */
"use client";
import React, { useEffect, useRef } from "react";
import TicketSummary from "@/components/TicketSummary"; // Make sure this import is correct
import { io } from "socket.io-client";
import Markdown from "react-markdown";
import PipecatWebSocketClient from "@/components/VoiceComponent";
import ChatArea from "@/components/ChatArea";

const ChatBot = () => {
  const [bookingInfo, setBookingInfo] = React.useState<any>({
    name: "",
    show: "",
    number_of_tickets: 0,
    total_amount: 0,
  });
  const [call, setCall] = React.useState(true);

  return (
    <div
      style={{
        minWidth: "100vw",
        minHeight: "100vh",
        width: "100vw",
        display: "flex",
        justifyContent: "space-between",
        overflowX: "hidden",
      }}
      className="min-h-screen bg-gray-900 text-gray-200 flex"
    >
      <title>Chatbot</title>
      {/* Chat UI */}
      {/* <PipecatWebSocketClient /> */}
      {call ? (
        <PipecatWebSocketClient setCall={setCall} />
      ) : (
        <ChatArea
          setCall={setCall}
          bookingInfo={bookingInfo}
          setBookingInfo={setBookingInfo}
        />
      )}
      <div
        style={{
          minWidth: "30vw",
          maxWidth: "30vw",
          minHeight: "99vh",
          maxHeight: "99vh",
        }}
        className="w-1/2 p-6"
      >
        <TicketSummary props={bookingInfo} />
      </div>
    </div>
  );
};

export default ChatBot;
