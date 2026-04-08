"use client";

import { useState } from "react";
import { Send } from "lucide-react";
import { MarkdownRenderer } from "@/components/markdown-renderer";

interface QAEntry {
  question: string;
  answer: string;
  citations: string[];
  savedTo?: string;
}

export default function AskPage() {
  const [question, setQuestion] = useState("");
  const [history, setHistory] = useState<QAEntry[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    if (!question.trim() || loading) return;

    const q = question;
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();

      if (data.error) {
        setHistory((prev) => [
          ...prev,
          { question: q, answer: `Error: ${data.error}`, citations: [] },
        ]);
      } else {
        // Auto-save to wiki outputs
        const saveRes = await fetch("/api/ask/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            question: q,
            answer: data.answer,
            citations: data.citations ?? [],
          }),
        });
        const saveData = await saveRes.json();

        setHistory((prev) => [
          ...prev,
          {
            question: q,
            answer: data.answer,
            citations: data.citations ?? [],
            savedTo: saveData.savedTo,
          },
        ]);
      }
    } catch {
      setHistory((prev) => [
        ...prev,
        { question: q, answer: "Failed to get answer", citations: [] },
      ]);
    }
    setLoading(false);
  }

  // Save is now automatic — no manual save needed

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 overflow-auto p-8">
        <div className="max-w-3xl mx-auto space-y-8">
          {history.length === 0 && !loading && (
            <div className="flex-1 flex items-center justify-center pt-20">
              <div className="text-center text-muted">
                <div className="text-5xl mb-4">💬</div>
                <p className="text-sm">
                  Ask a question about your knowledge base
                </p>
              </div>
            </div>
          )}

          {history.map((entry, i) => (
            <div key={i} className="space-y-4">
              {/* Question */}
              <div className="flex justify-end">
                <div className="bg-accent/10 border border-accent/20 rounded-xl px-4 py-3 max-w-lg">
                  <p className="text-sm">{entry.question}</p>
                </div>
              </div>

              {/* Answer */}
              <div className="bg-card border border-border rounded-xl p-6">
                <MarkdownRenderer content={entry.answer} />

                {entry.citations.length > 0 && (
                  <div className="mt-4 pt-3 border-t border-border">
                    <p className="text-xs text-muted mb-1">Sources:</p>
                    <div className="flex flex-wrap gap-1">
                      {entry.citations.map((c, j) => (
                        <span
                          key={j}
                          className="text-xs px-2 py-0.5 rounded-full bg-accent/10 text-accent"
                        >
                          {c.replace(/\[\[|\]\]/g, "").split("|").pop()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {entry.savedTo && (
                  <div className="mt-3">
                    <a
                      href={`/wiki?path=${encodeURIComponent(entry.savedTo)}`}
                      className="text-xs text-accent/60 hover:text-accent transition-colors"
                    >
                      Saved to wiki → {entry.savedTo}
                    </a>
                  </div>
                )}
              </div>
            </div>
          ))}

          {loading && (
            <div className="bg-card border border-border rounded-xl p-6">
              <div className="flex items-center gap-2 text-sm text-muted">
                <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
                Thinking...
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border p-4">
        <form
          onSubmit={handleAsk}
          className="max-w-3xl mx-auto flex items-center gap-3"
        >
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask anything about your knowledge base..."
            className="flex-1 px-4 py-3 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted/50 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 transition-colors"
            disabled={loading}
            autoFocus
          />
          <button
            type="submit"
            disabled={loading || !question.trim()}
            className="p-3 bg-accent text-background rounded-xl hover:bg-accent-hover transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Send size={16} />
          </button>
        </form>
      </div>
    </div>
  );
}
