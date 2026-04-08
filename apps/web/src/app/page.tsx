export default function Home() {
  return (
    <div className="flex h-screen">
      {/* Sidebar */}
      <aside className="w-64 border-r border-sidebar-border bg-sidebar flex flex-col">
        <div className="p-5 border-b border-sidebar-border">
          <h1 className="text-lg font-semibold tracking-tight">
            <span className="text-accent">Mind</span>Nest
          </h1>
          <p className="text-xs text-muted mt-1">Knowledge Base</p>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {[
            { icon: "📚", label: "Wiki", active: true },
            { icon: "🔍", label: "Search" },
            { icon: "💬", label: "Ask" },
            { icon: "📥", label: "Ingest" },
            { icon: "🩺", label: "Health" },
          ].map((item) => (
            <button
              key={item.label}
              className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                item.active
                  ? "bg-card-hover text-foreground"
                  : "text-muted hover:text-foreground hover:bg-card"
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="p-3 border-t border-sidebar-border">
          <div className="px-3 py-2 text-xs text-muted">
            v0.1.0 — Phase 0 Skeleton
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col">
        <header className="h-12 border-b border-border flex items-center px-6">
          <p className="text-sm text-muted">
            Welcome to MindNest
          </p>
        </header>

        <div className="flex-1 flex items-center justify-center">
          <div className="text-center space-y-4 max-w-md">
            <div className="text-6xl">🧠</div>
            <h2 className="text-2xl font-semibold tracking-tight">
              Your Knowledge, <span className="text-accent">Connected</span>
            </h2>
            <p className="text-muted text-sm leading-relaxed">
              Ingest sources, compile knowledge, ask questions.
              <br />
              The LLM builds the wiki. You explore it.
            </p>
            <div className="pt-4">
              <button className="px-5 py-2.5 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors">
                Get Started
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
