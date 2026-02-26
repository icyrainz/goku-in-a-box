import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { LiveStream } from "./components/LiveStream";
import { Vitals } from "./components/Vitals";
import { IterationTimeline } from "./components/IterationTimeline";
import { PromptModal } from "./components/PromptModal";

const queryClient = new QueryClient();

export default function App() {
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <Header onPromptClick={() => setPromptOpen(true)} />
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
        {promptOpen && <PromptModal onClose={() => setPromptOpen(false)} />}
      </div>
    </QueryClientProvider>
  );
}
