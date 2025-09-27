import { Outlet, Link } from "react-router-dom";

export default function App() {
  return (
    <div className="min-h-full">
      <header className="border-b border-uxgray/60">
        <div className="mx-auto max-w-4xl px-4 py-4 flex items-center justify-between">
          <div className="text-xl tracking-widest">
            EVE <span className="text-uxorange">•</span> DEMOS
          </div>
          <nav className="text-sm opacity-80">
            <Link to="/admin" className="hover:opacity-100">Admin</Link>
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <Outlet />
      </main>
      <footer className="mx-auto max-w-4xl px-4 py-6 text-xs opacity-60">
        © {new Date().getFullYear()} User Experience Media
      </footer>
    </div>
  );
}
