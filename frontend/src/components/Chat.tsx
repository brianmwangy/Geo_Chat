"use client";

import { useState, useEffect, useRef } from "react";
import axios from "axios";
import clsx from "clsx";
import styles from "../styles/chat.module.scss";

interface Message {
  sender: "user" | "bot";
  text: string;
}

interface QueryResponse {
  datasets: string[];
  bounds: number[];
  features: any[];
  insights: string[];
}

export default function Chat({ onQuery }: { onQuery: (data: QueryResponse) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [position, setPosition] = useState({ x: 20, y: 20 });
  const [dragging, setDragging] = useState(false);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  const chatRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMsg: Message = { sender: "user", text: input };
    setMessages((prev) => [...prev, newMsg]);
    setLoading(true);
    setInput("");

    try {
      const res = await axios.post("http://localhost:8000/query", { text: newMsg.text });
      const data: QueryResponse = res.data;
      console.log("API Response:", data); // Debug: inspect response

      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: data.insights[0] || `Showing data from ${data.datasets.join(", ")}` },
      ]);
      onQuery(data);
    } catch (err) {
      console.error("Query error:", err);
      setMessages((prev) => [
        ...prev,
        { sender: "bot", text: "Error processing query." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const startDrag = (e: React.MouseEvent) => {
    if (chatRef.current) {
      const rect = chatRef.current.getBoundingClientRect();
      setDragging(true);
      setOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }
  };

  const duringDrag = (e: MouseEvent) => {
    if (dragging) {
      setPosition({
        x: e.clientX - offset.x,
        y: e.clientY - offset.y,
      });
    }
  };

  const stopDrag = () => setDragging(false);

  useEffect(() => {
    if (dragging) {
      window.addEventListener("mousemove", duringDrag);
      window.addEventListener("mouseup", stopDrag);
    } else {
      window.removeEventListener("mousemove", duringDrag);
      window.removeEventListener("mouseup", stopDrag);
    }
    return () => {
      window.removeEventListener("mousemove", duringDrag);
      window.removeEventListener("mouseup", stopDrag);
    };
  }, [dragging, offset]);

  return (
    <div
      ref={chatRef}
      className={clsx(styles.chatContainer)}
      style={{
        top: position.y,
        left: position.x,
        position: "fixed",
        cursor: dragging ? "grabbing" : "default",
      }}
    >
      <div className={styles.chatHeader} onMouseDown={startDrag}>
        <span>Geo Chat Assistant</span>
      </div>

      <div className={styles.messages}>
        {messages.map((msg, i) => (
          <div key={i} className={clsx(styles.message, styles[msg.sender])}>
            {msg.text}
          </div>
        ))}
        {loading && <div className={styles.loading}>Processing...</div>}
        <div ref={chatEndRef} />
      </div>

      <div className={styles.inputArea}>
        <input
          type="text"
          placeholder="Ask about buildings, roads, or POIs..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && sendMessage()}
        />
        <button onClick={sendMessage}>Chat</button>
      </div>
    </div>
  );
}