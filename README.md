<div align="center">

<img src="public/window.svg" alt="AegisShield Logo" width="120" height="120" />

# 🛡️ AegisShield

**Enterprise Security Middleware for Agentic AI**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
[![Security: Enterprise](https://img.shields.io/badge/Security-Enterprise%20Grade-success)](#)
[![Status: Active](https://img.shields.io/badge/Status-Active-brightgreen)](#)

> **Real-time supply-chain security, risk scoring, and zero-trust redaction for third-party AI agent skills.**

[Features](#-key-capabilities) • [Quick Start](#-quick-start) • [API Integration](#-api-integration) • [Documentation](#-usage)

</div>

---

## 🛑 The Problem: Agentic Vulnerability

As AI agents execute third-party "tools" or "skills," they inherently trust external code. These tools often harbor severe security vulnerabilities:
- **Hardcoded API keys** leaked via debug prints.
- **Environment variables** exposed during crash traces.
- **Unsafe network calls** resulting in data exfiltration.

When an agent executes these compromised tools, sensitive output is captured and injected directly into the LLM’s context window, exposing your production credentials to third-party model providers.

## 🛡️ The Solution: AegisShield

**AegisShield** is a production-ready security auditing and runtime protection layer built to neutralize credential leakage and data exfiltration *before* they ever reach the LLM context window. 

We provide a zero-trust wrapper that sanitizes tool outputs in microseconds, ensuring your agents remain powerful without compromising your organization's security posture.

---

## ✨ Key Capabilities

### 🔍 Pre-Install Static Auditor
Perform deep inspection of any third-party skill before it runs.
- **Regex & AST Analysis:** Instantly detects hard-coded credentials, wallet keys, and exposed `.env` references.
- **Dependency Scanning:** Flags unsafe subprocess executions and unverified network requests.

### ⚡ Runtime Wrapper & Redaction (Sub-40ms)
An invisible shield for your LLM context.
- **Live Sanitization:** Intercepts tool outputs at runtime, replacing secrets with `[REDACTED by AegisShield]`.
- **Zero Latency Cost:** Engineered for high-throughput AI pipelines with sub-40ms overhead.

### 📊 Governance & Compliance Ledger
Enterprise-ready audit trails for SecOps teams.
- **Policy Enforcement:** Map findings to organizational governance policies with strict allow/deny lists.
- **Immutable History:** Persistent local scan history with risk trend sparklines and exportable JSON audit reports.

### 🎨 High-Density Security Dashboard
A pixel-perfect, premium SaaS interface.
- Features canvas-based constellation animations, SVG risk gauges, and deep drill-down analytics into vulnerability line numbers and evidence snippets.

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** 18.17+ 
- npm, yarn, or pnpm

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/yourusername/aegis-scanner.git
cd aegis-scanner

# 2. Install dependencies
npm install

# 3. Launch the security dashboard
npm run dev
```

> **Access the Dashboard:** Open [http://localhost:3000](http://localhost:3000) in your browser to start auditing.

---

## 💻 Usage

### 1. Interactive Dashboard
- **Drag & Drop:** Instantly scan `.py`, `.js`, or `.zip` files by dropping them into the target zone.
- **GitHub Integration:** Paste any public GitHub URL for a comprehensive repository vulnerability scan.
- **Remediation:** View detailed vulnerability breakdowns, including exact line numbers and actionable fixes.

### 2. Runtime Wrapper Simulator
Test the redaction engine directly in the browser:
- Click **Apply Wrapper**.
- Paste simulated raw output (or load from a recent scan).
- Click **Run Wrapper** to witness real-time secret sanitization and latency metrics.

---

## 🔌 API Integration

Seamlessly integrate AegisShield into your existing LangChain, LlamaIndex, or custom agent pipelines.

### `POST /api/wrapper/redact`
Sanitize tool outputs before feeding them back to your LLM.

**Request:**
```bash
curl -X POST http://localhost:3000/api/wrapper/redact \
  -H 'Content-Type: application/json' \
  -d '{"text": "Connecting to DB... DEBUG: DATABASE_URL=postgres://user:pass@localhost:5432/db"}'
```

**Response:**
```json
{
  "output": "Connecting to DB... DEBUG: DATABASE_URL=[REDACTED by AegisShield]",
  "redactions": 1,
  "output_chars": 67,
  "input_chars": 84,
  "latency_ms": 12
}
```

---

## 🛠️ Technology Stack

- **Core:** [Next.js 16](https://nextjs.org/) (App Router)
- **Styling:** [Tailwind CSS 4](https://tailwindcss.com/) with a custom, high-contrast Enterprise Design System
- **Visuals:** HTML5 Canvas (GPU-accelerated), CSS Micro-animations, Intersection Observers
- **Typography:** Inter (UI) & JetBrains Mono (Code)

---

## 📜 License

AegisShield is open-source software licensed under the [MIT License](LICENSE).
