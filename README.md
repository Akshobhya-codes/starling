# Starling - AI-Powered Real-Time City Operations Platform

![Starling Demo](docs/starling-demo.png)

Starling is an AI-powered real-time command center for city-wide incident awareness and vehicle tracking in San Francisco. It gives a single operator the situational awareness of an entire operations team — scanning live cameras, detecting vehicles, tracking incidents, and providing tactical intelligence through natural language.

## Features

### BOLO System (Be On the Lookout)
The flagship feature. Type "track a red sedan" and the AI:
- Continuously scans **39+ live Caltrans traffic cameras** using GPT-4o vision
- Scans 10 cameras every 8 seconds, rotating through all feeds
- Detects matching vehicles with **85%+ confidence** and strict color matching
- Freezes a screenshot as forensic proof with **annotated bounding boxes**, location, timestamp, and confidence overlay
- Real-time sighting alerts pushed via Server-Sent Events
- Supports **multiple simultaneous BOLOs** — scan for different vehicles in the same camera frame
- 5-minute dedup cooldown prevents duplicate alerts
- Pause/Resume per BOLO to conserve API credits

### Nemo AI Agent
A terminal-style chatbot powered by OpenAI GPT-4o:
- Natural language commands: "what's happening near the Bay Bridge?", "track a white sedan"
- Analyzes active incidents, assesses threat levels, provides tactical recommendations
- Navigates the 3D map to relevant locations on command
- Filters incidents by type (accident, fire, medical, police, etc.)

### 3D Operations Map
Photorealistic 3D San Francisco powered by CesiumJS + Google 3D Tiles:
- Fly around the city with building-level detail
- Camera markers, incident markers, BOLO sighting markers
- Bounding box and radius tools for area analysis
- Click any camera to open its live feed

### Live Simulated Traffic Flow
Real-time vehicle simulation on actual road networks:
- Up to 800 vehicles following real road polylines from OpenStreetMap
- Speed varies by road type and dynamically adjusts near incidents
- Traffic density visualization (empty/light/moderate/heavy/gridlock)
- Vehicles clamped to 3D terrain surface

### Incident Detection & Hypothesis Engine
AI-powered incident tracking from live data feeds:
- Ingests data from **511.org** and **DataSF** public safety feeds
- Builds hypotheses: candidate -> corroborated -> active -> resolved
- Severity levels, confidence scores, evidence chains
- Predicted impact radius with delay estimates

### Live Camera System
- 39+ real Caltrans CCTV cameras loaded via API
- Camera viewer with navigation and camera list sidebar
- Live feed refresh with timestamp overlay

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS |
| 3D Map | CesiumJS + Google Photorealistic 3D Tiles |
| AI Chat | OpenAI GPT-4o (Nemo agent) |
| AI Vision | OpenAI GPT-4o (BOLO vehicle scanning) |
| Image Processing | Sharp (proof annotation with SVG overlays) |
| Real-time | Server-Sent Events |
| Data Sources | Caltrans CCTV API, 511.org, DataSF, OpenStreetMap |

## Getting Started

### Prerequisites
- Node.js 18+
- OpenAI API key (Tier 1 recommended for BOLO scanning)

### Setup

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Add your API keys to .env

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the operations center.

### Environment Variables

```env
# Required
OPENAI_API_KEY=           # OpenAI API key (GPT-4o for chat + vision)

# Optional
GEMINI_API_KEY=           # Google Gemini (fallback vision provider)
GOOGLE_MAPS_API_KEY=      # Google Maps 3D Tiles
NEXT_PUBLIC_CESIUM_TOKEN= # CesiumJS ion token
FIVE11_API_KEY=           # 511.org traffic data
```

## Usage

1. Open the app and interact with **Nemo** in the terminal panel
2. Type `track a red sedan` to issue a BOLO
3. Watch the BOLO panel for real-time sightings with proof images
4. Click **VIEW PROOF** to see annotated screenshots
5. Click **OPEN CAMERA** to view the live feed
6. Use the 3D map to explore incidents and camera locations
7. Draw a **bounding box** to see live simulated traffic flow

## Team

- **Akshobhya Gupta** - akshobhya.gupta.dev@gmail.com
- **Abhiram Segu** - abhiram.segu@sjsu.edu
