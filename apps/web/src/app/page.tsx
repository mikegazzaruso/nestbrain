import Link from "next/link";
import { BookOpen, Search, MessageCircle, Download } from "lucide-react";

export default function Home() {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-8 max-w-2xl">
        <div className="space-y-4">
          <div className="text-7xl">🧠</div>
          <h2 className="text-3xl font-semibold tracking-tight">
            Your Knowledge, <span className="text-accent">Connected</span>
          </h2>
          <p className="text-muted text-base leading-relaxed max-w-md mx-auto">
            Ingest sources, compile knowledge, ask questions.
            The LLM builds the wiki. You explore it.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-4 max-w-lg mx-auto">
          {[
            {
              href: "/ingest",
              icon: Download,
              title: "Ingest",
              desc: "Add sources to your knowledge base",
            },
            {
              href: "/wiki",
              icon: BookOpen,
              title: "Browse Wiki",
              desc: "Explore your compiled knowledge",
            },
            {
              href: "/search",
              icon: Search,
              title: "Search",
              desc: "Find anything in your wiki",
            },
            {
              href: "/ask",
              icon: MessageCircle,
              title: "Ask",
              desc: "Query your knowledge base",
            },
          ].map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="group p-5 rounded-xl border border-border bg-card hover:bg-card-hover hover:border-accent/30 transition-all text-left"
              >
                <Icon
                  size={20}
                  className="text-accent mb-3 group-hover:scale-110 transition-transform"
                />
                <h3 className="font-medium text-sm mb-1">{item.title}</h3>
                <p className="text-xs text-muted">{item.desc}</p>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
