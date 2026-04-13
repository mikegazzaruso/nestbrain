import { Suspense } from "react";
import { EditorView } from "./editor-view";

export const dynamic = "force-dynamic";

export default function EditorPage() {
  return (
    <Suspense fallback={<EditorFallback />}>
      <EditorView />
    </Suspense>
  );
}

function EditorFallback() {
  return (
    <div className="flex-1 flex items-center justify-center text-muted/50 text-sm">
      Loading editor…
    </div>
  );
}
