# Cosmic Playground 🚀✨

Welcome to **Cosmic Playground**, an interactive Spacetime Lab and Rocket Simulator built with modern web technologies. This project explores gravitational physics, universe expansion, and orbital mechanics in a beautiful 3D web interface.

## 🌟 Features

- **Spacetime Gravity Sandbox**: Place stars and planets, and watch them orbit and warp spacetime dynamically. Features real-time planetary physics and time-scaling (including rewind and universe expansion).
- **Rocket Simulator**: Launch a rocket and simulate its trajectory and phases using adjustible parameters.
- **Interactive 3D UI**: Fully interactive 3D visualizations built using `three.js` and React Three Fiber.
- **Glassmorphism Design**: Sleek and modern user interface styled with Tailwind CSS and Radix UI primitives.

## 🛠️ Technologies Used

- **Framework**: [React 18](https://react.dev/) + [Vite](https://vitejs.dev/)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **3D Graphics**: [Three.js](https://threejs.org/), [@react-three/fiber](https://docs.pmnd.rs/react-three-fiber), [@react-three/drei](https://github.com/pmndrs/drei)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com/) + [Radix UI](https://www.radix-ui.com/)
- **Icons**: [Lucide React](https://lucide.dev/)

## 🚀 Getting Started

Follow these instructions to set up and run the project locally.

### Prerequisites

Make sure you have [Node.js](https://nodejs.org/) (v18+) and `npm` installed.

### Installation

1. **Clone the repository:**
   ```bash
   git clone <YOUR_GIT_URL>
   cd cosmic-playground
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the development server:**
   ```bash
   npm run dev
   ```

4. **Open your browser:**
   Navigate to `http://localhost:5173` (or the port specified in your terminal) to explore the playground!

## 🎮 How to Play

- **Spacetime Mode:** Drag to orbit the camera, scroll to zoom, and use the left panel to add celestial objects to warp spacetime. You can play, pause, or rewind time.
- **Rocket Mode:** Switch to the Rocket tab to adjust parameters (like fuel and thrust), launch your creation, and observe its altitude and trajectory.
