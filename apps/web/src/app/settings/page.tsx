"use client";

import { useEffect, useState } from "react";
import {
  Settings as SettingsIcon,
  Check,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
} from "lucide-react";

interface OpenAIModel {
  id: string;
  owned_by: string;
}

export default function SettingsPage() {
  const [provider, setProvider] = useState<"claude-cli" | "openai">("claude-cli");
  const [claudeModel, setClaudeModel] = useState("sonnet");
  const [openaiApiKey, setOpenaiApiKey] = useState("");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o");
  const [models, setModels] = useState<OpenAIModel[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  // Load current settings
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        if (data.llm) {
          setProvider(data.llm.provider);
          setClaudeModel(data.llm.claudeModel ?? "sonnet");
          setOpenaiApiKey(data.llm.openaiApiKey ?? "");
          setOpenaiModel(data.llm.openaiModel ?? "gpt-4o");
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Load OpenAI models when provider is openai and key exists
  useEffect(() => {
    if (provider === "openai" && openaiApiKey && !openaiApiKey.startsWith("sk-...")) {
      loadModels(openaiApiKey);
    } else if (provider === "openai" && openaiApiKey.startsWith("sk-...")) {
      // Key is masked, load with saved key
      loadModels();
    }
  }, [provider]);

  async function loadModels(key?: string) {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const url = key ? `/api/openai/models?key=${encodeURIComponent(key)}` : "/api/openai/models";
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) {
        setModelsError(data.error);
        setModels([]);
      } else {
        setModels(data.models ?? []);
      }
    } catch {
      setModelsError("Failed to load models");
      setModels([]);
    }
    setModelsLoading(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    try {
      await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          llm: {
            provider,
            claudeModel,
            openaiApiKey,
            openaiModel,
          },
        }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch {
      // ignore
    }
    setSaving(false);
  }

  async function handleTestKey() {
    if (!openaiApiKey || openaiApiKey.startsWith("sk-...")) return;
    await loadModels(openaiApiKey);
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 size={20} className="text-muted animate-spin" />
      </div>
    );
  }

  return (
    <div className="flex-1 p-8 overflow-auto">
      <div className="max-w-xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <SettingsIcon size={20} className="text-muted" />
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        </div>

        {/* LLM Provider */}
        <section className="mb-10">
          <h2 className="text-sm font-medium text-muted/70 uppercase tracking-wider mb-4">
            LLM Provider
          </h2>

          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Claude option */}
            <button
              onClick={() => setProvider("claude-cli")}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                provider === "claude-cli"
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-border hover:bg-card"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">Claude</span>
                {provider === "claude-cli" && (
                  <Check size={14} className="text-accent" />
                )}
              </div>
              <p className="text-[11px] text-muted/60 leading-relaxed">
                Uses your Claude Max subscription via CLI. No API key needed.
              </p>
            </button>

            {/* OpenAI option */}
            <button
              onClick={() => setProvider("openai")}
              className={`p-4 rounded-xl border-2 text-left transition-all ${
                provider === "openai"
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-border hover:bg-card"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium">OpenAI</span>
                {provider === "openai" && (
                  <Check size={14} className="text-accent" />
                )}
              </div>
              <p className="text-[11px] text-muted/60 leading-relaxed">
                Uses OpenAI API. Requires an API key.
              </p>
            </button>
          </div>

          {/* Claude settings */}
          {provider === "claude-cli" && (
            <div className="space-y-4 p-5 rounded-xl bg-card border border-border">
              <div>
                <label className="block text-xs text-muted/70 mb-2">Model</label>
                <select
                  value={claudeModel}
                  onChange={(e) => setClaudeModel(e.target.value)}
                  className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                >
                  <option value="sonnet">Claude Sonnet 4.6</option>
                  <option value="opus">Claude Opus 4.6</option>
                  <option value="haiku">Claude Haiku 4.5</option>
                </select>
              </div>
              <p className="text-[11px] text-muted/40 leading-relaxed">
                Authenticated via your Claude CLI session. Run{" "}
                <code className="text-accent/60 bg-accent/5 px-1 rounded">claude auth login</code>{" "}
                in terminal if needed.
              </p>
            </div>
          )}

          {/* OpenAI settings */}
          {provider === "openai" && (
            <div className="space-y-4 p-5 rounded-xl bg-card border border-border">
              {/* API Key */}
              <div>
                <label className="block text-xs text-muted/70 mb-2">API Key</label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={showKey ? "text" : "password"}
                      value={openaiApiKey}
                      onChange={(e) => setOpenaiApiKey(e.target.value)}
                      placeholder="sk-..."
                      className="w-full px-3 py-2.5 pr-10 bg-background border border-border rounded-lg text-sm text-foreground placeholder:text-muted/30 focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20 font-mono"
                    />
                    <button
                      onClick={() => setShowKey(!showKey)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted/40 hover:text-muted transition-colors"
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <button
                    onClick={handleTestKey}
                    disabled={!openaiApiKey || openaiApiKey.startsWith("sk-...")}
                    className="px-3 py-2.5 bg-background border border-border rounded-lg text-xs text-muted hover:text-foreground hover:border-accent/30 transition-colors disabled:opacity-30"
                  >
                    Test
                  </button>
                </div>
              </div>

              {/* Model selector */}
              <div>
                <label className="block text-xs text-muted/70 mb-2">Model</label>
                {modelsLoading ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-muted">
                    <Loader2 size={12} className="animate-spin" />
                    Loading models...
                  </div>
                ) : modelsError ? (
                  <div className="flex items-center gap-2 px-3 py-2.5 text-xs text-red-400">
                    <AlertCircle size={12} />
                    {modelsError}
                  </div>
                ) : models.length > 0 ? (
                  <select
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                  >
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.id}
                      </option>
                    ))}
                  </select>
                ) : (
                  <select
                    value={openaiModel}
                    onChange={(e) => setOpenaiModel(e.target.value)}
                    className="w-full px-3 py-2.5 bg-background border border-border rounded-lg text-sm text-foreground focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/20"
                  >
                    <option value="gpt-4o">gpt-4o</option>
                    <option value="gpt-4o-mini">gpt-4o-mini</option>
                    <option value="gpt-4-turbo">gpt-4-turbo</option>
                    <option value="o4-mini">o4-mini</option>
                  </select>
                )}
                {models.length > 0 && (
                  <p className="text-[10px] text-muted/30 mt-1.5">
                    {models.length} models available
                  </p>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Save button */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2.5 bg-accent text-background text-sm font-medium rounded-lg hover:bg-accent-hover transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? (
              <Loader2 size={14} className="animate-spin" />
            ) : saved ? (
              <Check size={14} />
            ) : null}
            {saved ? "Saved" : "Save Settings"}
          </button>
          {saved && (
            <span className="text-xs text-green-400/70">
              Settings saved successfully
            </span>
          )}
        </div>

        {/* Danger Zone */}
        <DangerZone />
      </div>
    </div>
  );
}

function DangerZone() {
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function handleWipe() {
    if (confirmText !== "DELETE") return;
    setWiping(true);
    try {
      const res = await fetch("/api/settings/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: "DELETE_EVERYTHING" }),
      });
      const data = await res.json();
      if (data.ok) {
        setWiped(true);
        setConfirmText("");
      }
    } catch { /* */ }
    setWiping(false);
  }

  return (
    <section className="mt-12 pt-8 border-t border-red-500/20">
      <h2 className="text-sm font-medium text-red-400/80 uppercase tracking-wider mb-4">
        Danger Zone
      </h2>

      <div className="p-5 rounded-xl bg-red-500/[0.03] border border-red-500/20">
        <h3 className="text-sm font-medium text-red-400 mb-1">Wipe All Data</h3>
        <p className="text-xs text-muted/60 leading-relaxed mb-4">
          This will permanently delete <strong className="text-red-400/80">all ingested sources</strong>,{" "}
          <strong className="text-red-400/80">all compiled wiki articles</strong>,{" "}
          <strong className="text-red-400/80">all Q&A outputs</strong>, and the{" "}
          <strong className="text-red-400/80">vector search index</strong>.
          This action cannot be undone.
        </p>

        {wiped ? (
          <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
            <p className="text-xs text-red-400">All data has been wiped. The knowledge base is empty.</p>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder='Type "DELETE" to confirm'
              className="flex-1 px-3 py-2 bg-background border border-red-500/30 rounded-lg text-sm text-foreground placeholder:text-muted/30 focus:outline-none focus:border-red-500/60 focus:ring-1 focus:ring-red-500/20"
            />
            <button
              onClick={handleWipe}
              disabled={confirmText !== "DELETE" || wiping}
              className="px-4 py-2 bg-red-500/20 text-red-400 text-sm font-medium rounded-lg hover:bg-red-500/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {wiping && <Loader2 size={14} className="animate-spin" />}
              Wipe Everything
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
