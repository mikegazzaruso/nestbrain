"use client";

// Open-core stub — the real project-creation modal ships with the Dev
// module and replaces this file in official builds.

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (projectName: string) => Promise<void>;
}

export function NewProjectModal(_props: NewProjectModalProps) {
  return null;
}
