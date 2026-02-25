import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Header } from "./components/Header";
import { PromptEditor } from "./components/PromptEditor";
import { LiveStream } from "./components/LiveStream";
import { Vitals } from "./components/Vitals";
import { IterationTimeline } from "./components/IterationTimeline";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <Header />
        <main className="flex-1 grid grid-cols-[1fr_350px] grid-rows-[1fr_1fr] gap-4 p-4 overflow-hidden">
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4">
            <PromptEditor />
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 row-span-2 overflow-auto">
            <LiveStream />
          </div>
          <div className="bg-gray-900 rounded-lg border border-gray-800 p-4 flex gap-4">
            <div className="flex-1">
              <Vitals />
            </div>
            <div className="flex-1">
              <IterationTimeline />
            </div>
          </div>
        </main>
      </div>
    </QueryClientProvider>
  );
}
