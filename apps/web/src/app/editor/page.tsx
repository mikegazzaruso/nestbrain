import { Suspense } from "react";
import { EditorView, EditorFallback } from "./editor-view";

export const dynamic = "force-dynamic";

export default function EditorPage() {
  return (
    <Suspense fallback={<EditorFallback />}>
      <EditorView />
    </Suspense>
  );
}
