import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <div className="h-screen flex flex-col bg-gray-950 text-gray-100">
        <header className="px-6 py-4 bg-gray-900 border-b border-gray-700">
          <h1 className="text-xl font-bold">Goku-in-a-Box</h1>
        </header>
        <main className="flex-1 p-4">
          <p className="text-gray-500">Dashboard scaffolding complete.</p>
        </main>
      </div>
    </QueryClientProvider>
  );
}
