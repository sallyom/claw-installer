import React, { useEffect, useRef, useState } from "react";

interface Props {
  deployId: string;
  onDeploySuccess?: () => void;
}

interface LogEntry {
  line: string;
  type: "log" | "error" | "success" | "cmd";
}

function classifyLine(line: string): LogEntry["type"] {
  if (line.startsWith("ERROR:")) return "error";
  if (line.startsWith("$")) return "cmd";
  if (
    line.includes("complete") ||
    line.includes("running at") ||
    line.includes("Complete")
  )
    return "success";
  return "log";
}

export default function LogStream({ deployId, onDeploySuccess }: Props) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [status, setStatus] = useState<string>("connecting");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

    ws.onopen = () => {
      setStatus("connected");
      ws.send(JSON.stringify({ type: "subscribe", deployId }));
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === "log") {
        setLogs((prev) => [
          ...prev,
          { line: msg.line, type: classifyLine(msg.line) },
        ]);
      } else if (msg.type === "status") {
        setStatus(msg.status);
        if (msg.status === "running") {
          onDeploySuccess?.();
        }
      }
    };

    ws.onclose = () => {
      setStatus("disconnected");
    };

    return () => ws.close();
  }, [deployId]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <div className="card" style={{ marginTop: "1rem" }}>
      <h3>
        Deploy Log{" "}
        <span
          className={`badge ${status === "running" ? "badge-running" : status === "failed" ? "badge-failed" : ""}`}
        >
          {status}
        </span>
      </h3>
      <div className="log-stream" ref={logRef}>
        {logs.length === 0 && (
          <div className="log-line">Waiting for output...</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className={`log-line ${entry.type}`}>
            {entry.line}
          </div>
        ))}
      </div>
    </div>
  );
}
