import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { LiveStream } from "./components/LiveStream";
import { Vitals } from "./components/Vitals";
import { IterationTimeline } from "./components/IterationTimeline";
import { PromptModal } from "./components/PromptModal";
import { FileBrowser } from "./components/FileBrowser";

const queryClient = new QueryClient();

export default function App() {
  const [promptOpen, setPromptOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);

  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-washi text-sumi">
        <Header onPromptClick={() => setPromptOpen(true)} onFilesClick={() => setFilesOpen(true)} />
        <main className="flex-1 grid grid-cols-[1fr_380px] gap-5 p-5 overflow-hidden">
          <div className="ink-panel rounded-lg p-5 overflow-hidden">
            <LiveStream />
          </div>
          <div className="flex flex-col gap-5 overflow-hidden">
            <div className="flex-1 ink-panel rounded-lg p-5 overflow-hidden">
              <Vitals />
            </div>
            <div className="flex-[1.2] ink-panel rounded-lg p-5 overflow-hidden">
              <IterationTimeline />
            </div>
          </div>
        </main>
        {promptOpen && <PromptModal onClose={() => setPromptOpen(false)} />}
        {filesOpen && <FileBrowser onClose={() => setFilesOpen(false)} />}
      </div>
    </QueryClientProvider>
  );
}
