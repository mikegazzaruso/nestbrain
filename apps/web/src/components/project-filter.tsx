"use client";

// Open-core stub — the real project-scoped search/ask filter ships with the
// Dev module and replaces this file in official builds.

interface ProjectFilterProps {
  value: string | null;
  onChange: (project: string | null) => void;
  className?: string;
}

export function ProjectFilter(_props: ProjectFilterProps) {
  return null;
}
