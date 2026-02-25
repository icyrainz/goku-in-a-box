import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { PromptEditor } from "./components/PromptEditor";
import { LiveStream } from "./components/LiveStream";
import { Vitals } from "./components/Vitals";
import { IterationTimeline } from "./components/IterationTimeline";

const queryClient = new QueryClient();

export default function App() {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <Header />
        <main className="flex-1 grid grid-cols-[1fr_350px] gap-4 p-4 overflow-hidden">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
            <LiveStream />
          </div>
          <div className="flex flex-col gap-4 overflow-hidden">
            <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
              <Vitals />
            </div>
            <div className="flex-1 bg-gray-900 rounded-lg border border-gray-800 p-4 overflow-auto">
              <IterationTimeline />
            </div>
          </div>
        </main>

        {/* Collapsible prompt drawer */}
        <div className="border-t border-gray-800">
          <button
            onClick={() => setPromptOpen(!promptOpen)}
            className="w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-900 transition-colors"
          >
            <span className={`transition-transform ${promptOpen ? "rotate-90" : ""}`}>&#9656;</span>
            <span className="uppercase tracking-wider font-semibold">Prompt</span>
          </button>
          {promptOpen && (
            <div className="h-64 px-4 pb-4">
              <PromptEditor />
            </div>
          )}
        </div>
      </div>
    </QueryClientProvider>
  );
}
