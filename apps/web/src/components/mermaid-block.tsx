"use client";

import { useEffect, useRef, useState } from "react";

export function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          darkMode: true,
          themeVariables: {
            primaryColor: "#6c9cfc",
            primaryTextColor: "#e8e8e8",
            lineColor: "#444",
            secondaryColor: "#1a1a2e",
            tertiaryColor: "#141414",
          },
        });
        const id = `mermaid-${Math.random().toString(36).slice(2, 8)}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setSvg(`<pre style="color:#f87171;font-size:12px">Invalid mermaid diagram</pre>`);
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  return (
    <div
      ref={ref}
      className="my-4 p-4 bg-[#0c0c0e] border border-border/50 rounded-xl overflow-x-auto flex justify-center"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
