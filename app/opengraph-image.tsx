import { ImageResponse } from "next/og";

export const alt = "Workflows — durable functions that survive anything";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#050505",
          padding: "72px",
          color: "#fafafa",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          <div
            style={{
              width: 0,
              height: 0,
              borderLeft: "17px solid transparent",
              borderRight: "17px solid transparent",
              borderBottom: "29px solid #fafafa",
            }}
          />
          <div style={{ fontSize: 34, letterSpacing: "-0.01em" }}>Workflows</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.05,
              letterSpacing: "-0.03em",
              maxWidth: 900,
            }}
          >
            Functions that survive anything
          </div>
          <div style={{ fontSize: 30, color: "#a3a3a3", maxWidth: 900 }}>
            Durable execution, automatic retries, human approvals, month-long
            sleeps, parallel fan-out.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: "12px",
            fontSize: 22,
            color: "#737373",
          }}
        >
          <span style={{ color: "#60a5fa" }}>durable</span>
          <span>·</span>
          <span>workflow-sdk.dev</span>
        </div>
      </div>
    ),
    size,
  );
}
