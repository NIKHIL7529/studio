"use client";

/**
 * WorkspaceHome — Workspace management, project lifecycle, and entry screen (Phase 2).
 *
 * Responsibilities:
 * - Local workspace folder selection via File System Access API.
 * - Reconnects to previously selected workspace handle from IndexedDB on startup.
 * - Explicit permission state machine: not-selected, checking, granted, prompt-required, denied, unsupported, error.
 * - Discovers projects by enumerating directory entries in projects/<uuid>/project.json.
 * - Handles corrupt project documents gracefully without breaking workspace.
 * - Creates, opens, renames, and safely deletes projects (bounded to projects/<uuid>/ only).
 * - Switches to ProjectWorkspace when a project is opened.
 */

import * as React from "react";
import { useState, useEffect, useCallback } from "react";
import { BrowserCompatibility } from "@/components/BrowserCompatibility";
import {
  Button,
  IconButton,
  EmptyState,
  Panel,
  PanelHeader,
  SectionLabel,
  Divider,
  Badge,
  Modal,
  Input,
} from "@/components/ui";
import { AppLogo } from "@/components/AppLogo";
import { ProjectWorkspace } from "@/components/ProjectWorkspace";
import type {
  ProjectDocument,
  ProjectSummary,
  WorkspacePermissionState,
} from "../types/project.ts";
import {
  pickWorkspaceDirectory,
  checkDirectoryPermission,
  requestDirectoryPermission,
  listProjects,
  readProject,
  writeProject,
} from "../lib/workspace.ts";
import {
  moveToTrash,
  listTrashedProjects,
  restoreFromTrash,
  permanentlyDeleteProject,
  emptyTrash,
} from "../lib/trash.ts";
import { CacheManagerModal } from "./CacheManagerModal.tsx";
import {
  saveWorkspaceHandle,
  loadWorkspaceHandle,
  clearWorkspaceHandle,
  cleanupUnreferencedFileHandles,
} from "../lib/idb.ts";
import {
  createDefaultProject,
  sanitizeProjectName,
} from "../lib/projectValidation.ts";

// ─── Feature highlight card ───────────────────────────────────────────────────

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="flex gap-3 p-4 rounded-lg bg-cs-bg-muted border border-cs-border-subtle">
      <div className="shrink-0 mt-0.5 text-cs-accent" aria-hidden="true">
        {icon}
      </div>
      <div>
        <p className="text-sm font-medium text-cs-text-primary">{title}</p>
        <p className="mt-0.5 text-xs text-cs-text-secondary leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── Hero section ─────────────────────────────────────────────────────────────

function HeroSection() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="flex flex-col items-center text-center gap-5 pt-10 pb-8 px-6"
    >
      <div className="flex items-center gap-3">
        <AppLogo size={38} />
        <h1
          id="hero-heading"
          className="text-2xl font-bold tracking-tight text-cs-text-primary"
        >
          Content Studio
        </h1>
      </div>

      <p className="max-w-lg text-sm text-cs-text-secondary leading-relaxed">
        A browser-based, local-first video editor. Import your own videos, arrange clips on a
        timeline and export finished content — entirely on your computer, without uploading anything
        or creating an account.
      </p>

      <div className="flex items-center gap-2 mt-1 flex-wrap justify-center">
        <span className="inline-flex items-center gap-1.5 text-xs text-cs-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-cs-success inline-block" />
          No account required
        </span>
        <span className="text-cs-border-default">·</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-cs-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-cs-success inline-block" />
          Your files stay on your computer
        </span>
        <span className="text-cs-border-default">·</span>
        <span className="inline-flex items-center gap-1.5 text-xs text-cs-text-tertiary">
          <span className="w-1.5 h-1.5 rounded-full bg-cs-success inline-block" />
          No cloud upload
        </span>
      </div>
    </section>
  );
}

// ─── Features Section ─────────────────────────────────────────────────────────

function FeaturesSection() {
  return (
    <section aria-labelledby="features-heading" className="flex flex-col gap-3">
      <SectionLabel id="features-heading" className="px-1">
        How it works
      </SectionLabel>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          }
          title="Entirely local processing"
          description="Video decoding, editing and rendering happen in your browser using WebCodecs and Web Workers. No server ever touches your media."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          }
          title="Local workspace folder"
          description="Choose a folder on your computer as your workspace. Projects, timelines and exports live there under your control."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          }
          title="Timeline editing"
          description="Arrange clips, trim, split and sequence your footage on a multi-track timeline — coming in a later phase."
        />
        <FeatureCard
          icon={
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
              <circle cx="12" cy="12" r="10" />
              <line x1="2" y1="12" x2="22" y2="12" />
              <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
            </svg>
          }
          title="No account, no cloud"
          description="Content Studio works without sign-up, subscription, cloud storage or any backend. Open the site and start editing."
        />
      </div>
    </section>
  );
}

// ─── Main WorkspaceHome Component ─────────────────────────────────────────────

export function WorkspaceHome() {
  const [workspaceHandle, setWorkspaceHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [permissionState, setPermissionState] = useState<WorkspacePermissionState>("checking");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);

  // Active opened project
  const [activeProject, setActiveProject] = useState<ProjectDocument | null>(null);
  const [openingProjectId, setOpeningProjectId] = useState<string | null>(null);

  // Modals state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("Untitled Project");
  const [isCreatingProject, setIsCreatingProject] = useState(false);

  const [projectToRename, setProjectToRename] = useState<ProjectSummary | null>(null);
  const [renameInputVal, setRenameInputVal] = useState("");

  const [projectToDelete, setProjectToDelete] = useState<ProjectSummary | null>(null);
  const [isDeletingProject, setIsDeletingProject] = useState(false);

  // Trash & Cache state (Phase 6)
  const [trashedProjects, setTrashedProjects] = useState<ProjectSummary[]>([]);
  const [activeWorkspaceTab, setActiveWorkspaceTab] = useState<"projects" | "trash">("projects");
  const [projectToPermanentDelete, setProjectToPermanentDelete] = useState<ProjectSummary | null>(null);
  const [isPermanentlyDeleting, setIsPermanentlyDeleting] = useState(false);
  const [isRestoringFromTrash, setIsRestoringFromTrash] = useState(false);
  const [isCacheModalOpen, setIsCacheModalOpen] = useState(false);

  // Refresh project listing from active workspace
  const refreshProjectsList = useCallback(async (handle: FileSystemDirectoryHandle) => {
    setIsLoadingProjects(true);
    setWorkspaceError(null);
    try {
      const [list, trashed] = await Promise.all([
        listProjects(handle),
        listTrashedProjects(handle),
      ]);
      setProjects(list);
      setTrashedProjects(trashed);
    } catch (err: unknown) {
      console.warn("Failed to list projects:", err);
      setWorkspaceError(err instanceof Error ? err.message : "Failed to load projects from workspace.");
    } finally {
      setIsLoadingProjects(false);
    }
  }, []);

  // On mount: attempt to reconnect to stored workspace handle from IndexedDB
  useEffect(() => {
    let isCancelled = false;

    async function initWorkspace() {
      setPermissionState("checking");

      try {
        const storedHandle = await loadWorkspaceHandle();
        if (isCancelled) return;

        if (!storedHandle) {
          setPermissionState("not-selected");
          return;
        }

        setWorkspaceHandle(storedHandle);
        const perm = await checkDirectoryPermission(storedHandle);
        if (isCancelled) return;

        setPermissionState(perm);
        if (perm === "granted") {
          void refreshProjectsList(storedHandle);
        }
      } catch (err) {
        if (isCancelled) return;
        console.warn("Error during workspace initialization:", err);
        setPermissionState("not-selected");
      }
    }

    void initWorkspace();

    return () => {
      isCancelled = true;
    };
  }, [refreshProjectsList]);

  // Handle explicit directory selection
  const handleSelectWorkspace = async () => {
    setWorkspaceError(null);
    try {
      const handle = await pickWorkspaceDirectory();
      if (!handle) {
        // User cancelled picker
        return;
      }

      await saveWorkspaceHandle(handle);
      setWorkspaceHandle(handle);
      setPermissionState("granted");
      void refreshProjectsList(handle);
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setWorkspaceError(err.message);
      }
    }
  };

  // Re-request permission for stored handle
  const handleReconnectWorkspace = async () => {
    if (!workspaceHandle) return;
    setWorkspaceError(null);

    try {
      const status = await requestDirectoryPermission(workspaceHandle);
      setPermissionState(status);
      if (status === "granted") {
        void refreshProjectsList(workspaceHandle);
      }
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to request permission.");
    }
  };

  // Switch or disconnect workspace
  const handleDisconnectWorkspace = async () => {
    await clearWorkspaceHandle();
    setWorkspaceHandle(null);
    setPermissionState("not-selected");
    setProjects([]);
    setActiveProject(null);
  };

  // Open a project
  const handleOpenProject = async (projectId: string) => {
    if (!workspaceHandle) return;
    setOpeningProjectId(projectId);
    setWorkspaceError(null);

    try {
      const doc = await readProject(workspaceHandle, projectId);
      setActiveProject(doc);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : `Failed to open project ${projectId}`);
    } finally {
      setOpeningProjectId(null);
    }
  };

  // Create project submission
  const handleCreateProjectSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workspaceHandle) return;

    setIsCreatingProject(true);
    setWorkspaceError(null);

    try {
      const sanitized = sanitizeProjectName(newProjectName);
      const newDoc = createDefaultProject(sanitized);
      const savedDoc = await writeProject(workspaceHandle, newDoc);

      setIsCreateModalOpen(false);
      setNewProjectName("Untitled Project");
      await refreshProjectsList(workspaceHandle);
      setActiveProject(savedDoc);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to create project.");
    } finally {
      setIsCreatingProject(false);
    }
  };

  // Rename project submission
  const handleRenameProjectSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!workspaceHandle || !projectToRename) return;

    const sanitized = sanitizeProjectName(renameInputVal);
    if (!sanitized) return;

    try {
      const doc = await readProject(workspaceHandle, projectToRename.id);
      doc.name = sanitized;
      await writeProject(workspaceHandle, doc);
      setProjectToRename(null);
      await refreshProjectsList(workspaceHandle);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to rename project.");
    }
  };

  // Move to trash submission (Phase 6 recoverable deletion)
  const handleDeleteProjectSubmit = async () => {
    if (!workspaceHandle || !projectToDelete) return;

    setIsDeletingProject(true);
    try {
      await moveToTrash(workspaceHandle, projectToDelete.id);
      setProjectToDelete(null);
      await refreshProjectsList(workspaceHandle);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to move project to trash.");
    } finally {
      setIsDeletingProject(false);
    }
  };

  // Restore project from trash
  const handleRestoreProject = async (projectId: string) => {
    if (!workspaceHandle) return;
    setIsRestoringFromTrash(true);
    setWorkspaceError(null);
    try {
      await restoreFromTrash(workspaceHandle, projectId);
      await refreshProjectsList(workspaceHandle);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to restore project from trash.");
    } finally {
      setIsRestoringFromTrash(false);
    }
  };

  // Permanent delete from trash
  const handlePermanentDeleteSubmit = async () => {
    if (!workspaceHandle || !projectToPermanentDelete) return;

    setIsPermanentlyDeleting(true);
    setWorkspaceError(null);
    try {
      await permanentlyDeleteProject(workspaceHandle, projectToPermanentDelete.id);
      setProjectToPermanentDelete(null);
      await refreshProjectsList(workspaceHandle);

      // Clean up orphaned handles in background
      void (async () => {
        try {
          const remainingProjects = await listProjects(workspaceHandle);
          const activeIds = new Set<string>();
          for (const p of remainingProjects) {
            if (p.valid) {
              try {
                const doc = await readProject(workspaceHandle, p.id);
                for (const a of doc.assets) {
                  activeIds.add(a.handleRefId);
                }
              } catch {
                // ignore
              }
            }
          }
          await cleanupUnreferencedFileHandles(activeIds);
        } catch {
          // non-critical
        }
      })();
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to permanently delete project.");
    } finally {
      setIsPermanentlyDeleting(false);
    }
  };

  // Empty all trash
  const handleEmptyTrashSubmit = async () => {
    if (!workspaceHandle) return;
    setIsPermanentlyDeleting(true);
    setWorkspaceError(null);
    try {
      await emptyTrash(workspaceHandle);
      await refreshProjectsList(workspaceHandle);
    } catch (err: unknown) {
      setWorkspaceError(err instanceof Error ? err.message : "Failed to empty trash.");
    } finally {
      setIsPermanentlyDeleting(false);
    }
  };

  // If a project is currently active, render the ProjectWorkspace view!
  if (activeProject && workspaceHandle) {
    return (
      <ProjectWorkspace
        project={activeProject}
        workspaceHandle={workspaceHandle}
        onCloseProject={() => {
          setActiveProject(null);
          void refreshProjectsList(workspaceHandle);
        }}
        onProjectUpdated={(updatedDoc) => {
          setActiveProject(updatedDoc);
        }}
      />
    );
  }

  // Otherwise, render Workspace Home & Project Management
  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      {/* Hero */}
      <HeroSection />

      <Divider className="my-2" />

      {/* Main content columns */}
      <div className="mt-8 flex flex-col gap-6">
        {/* Error alert banner */}
        {workspaceError && (
          <div className="p-4 rounded-lg bg-cs-error/10 border border-cs-error/20 flex items-start justify-between gap-3 text-xs text-cs-error">
            <div className="flex items-start gap-2">
              <span className="shrink-0 mt-0.5">⚠️</span>
              <p className="leading-relaxed">{workspaceError}</p>
            </div>
            <IconButton label="Dismiss" size="sm" onClick={() => setWorkspaceError(null)}>
              ×
            </IconButton>
          </div>
        )}

        {/* ─── State 1: No workspace chosen yet ───────────────────────────── */}
        {permissionState === "not-selected" && (
          <Panel as="section" aria-labelledby="workspace-heading">
            <PanelHeader
              title="Workspace"
              description="Your local folder for projects and exports"
            />
            <EmptyState
              icon={
                <svg width="40" height="40" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                  <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                </svg>
              }
              title="Choose your workspace folder"
              description="Content Studio will create a 'projects/' subfolder in your chosen directory to store project data. Your original videos will remain in their existing locations and are never copied."
              action={
                <Button variant="primary" size="md" onClick={handleSelectWorkspace}>
                  Choose workspace folder
                </Button>
              }
            />
          </Panel>
        )}

        {/* ─── State 2: Checking stored permission ────────────────────────── */}
        {permissionState === "checking" && (
          <Panel as="section">
            <PanelHeader title="Workspace" />
            <div className="p-8 text-center text-xs text-cs-text-tertiary">
              Reconnecting to workspace…
            </div>
          </Panel>
        )}

        {/* ─── State 3: Stored handle exists but needs permission renewal ── */}
        {(permissionState === "prompt-required" || permissionState === "denied") && (
          <Panel as="section">
            <PanelHeader
              title="Workspace Permission Needed"
              actions={<Badge variant="warning">Attention</Badge>}
            />
            <div className="p-6 flex flex-col items-center text-center gap-4">
              <div className="w-10 h-10 rounded-full bg-cs-warning/15 flex items-center justify-center text-cs-warning">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                  <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                  <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                </svg>
              </div>
              <div className="max-w-md">
                <p className="text-sm font-medium text-cs-text-primary">
                  Permission required for &ldquo;{workspaceHandle?.name || "Workspace"}&rdquo;
                </p>
                <p className="mt-1 text-xs text-cs-text-secondary leading-relaxed">
                  Browser security requires re-authorizing access to your workspace folder each session to read and write project documents.
                </p>
              </div>
              <div className="flex items-center gap-3 mt-1">
                <Button variant="primary" size="md" onClick={handleReconnectWorkspace}>
                  Reconnect workspace
                </Button>
                <Button variant="secondary" size="md" onClick={handleSelectWorkspace}>
                  Choose another folder
                </Button>
              </div>
            </div>
          </Panel>
        )}

        {/* ─── State 4: Permission granted — Full Project Listing ─────────── */}
        {permissionState === "granted" && workspaceHandle && (
          <>
            {/* Active Workspace Bar */}
            <div className="flex items-center justify-between gap-4 p-4 rounded-lg bg-cs-bg-surface border border-cs-border-subtle">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded bg-cs-accent/10 border border-cs-accent/20 flex items-center justify-center text-cs-accent shrink-0">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                    <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
                  </svg>
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-cs-text-tertiary">Active Workspace</span>
                    <Badge variant="success">Connected</Badge>
                  </div>
                  <span className="text-sm font-medium text-cs-text-primary truncate" title={workspaceHandle.name}>
                    {workspaceHandle.name}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setIsCacheModalOpen(true)}
                  title="Inspect and clean workspace cache"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                    <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
                  </svg>
                  <span className="hidden sm:inline">Cache</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refreshProjectsList(workspaceHandle)}
                  disabled={isLoadingProjects}
                  title="Reload projects from folder"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                    <path d="M23 4v6h-6M1 20v-6h6" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  <span className="hidden sm:inline">Refresh</span>
                </Button>
                <Button variant="secondary" size="sm" onClick={handleSelectWorkspace}>
                  Change folder
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDisconnectWorkspace} title="Forget workspace">
                  Disconnect
                </Button>
              </div>
            </div>

            {/* Projects List Panel */}
            <Panel as="section" aria-labelledby="projects-heading">
              <PanelHeader
                title="Workspace Projects"
                description={
                  activeWorkspaceTab === "projects"
                    ? `${projects.length} active project${projects.length === 1 ? "" : "s"}`
                    : `${trashedProjects.length} project${trashedProjects.length === 1 ? "" : "s"} in trash`
                }
                actions={
                  activeWorkspaceTab === "projects" ? (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setNewProjectName("Untitled Project");
                        setIsCreateModalOpen(true);
                      }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      New project
                    </Button>
                  ) : trashedProjects.length > 0 ? (
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={handleEmptyTrashSubmit}
                      disabled={isPermanentlyDeleting}
                    >
                      Empty trash
                    </Button>
                  ) : null
                }
              />

              {/* Tab navigation */}
              <div className="flex border-b border-cs-border-subtle px-4 pt-1 gap-4 text-xs font-medium">
                <button
                  onClick={() => setActiveWorkspaceTab("projects")}
                  className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
                    activeWorkspaceTab === "projects"
                      ? "border-cs-accent text-cs-accent"
                      : "border-transparent text-cs-text-secondary hover:text-cs-text-primary"
                  }`}
                >
                  Active Projects
                  <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-cs-bg-elevated text-cs-text-secondary">
                    {projects.length}
                  </span>
                </button>
                <button
                  onClick={() => setActiveWorkspaceTab("trash")}
                  className={`pb-2 border-b-2 transition-colors flex items-center gap-1.5 ${
                    activeWorkspaceTab === "trash"
                      ? "border-cs-accent text-cs-accent"
                      : "border-transparent text-cs-text-secondary hover:text-cs-text-primary"
                  }`}
                >
                  Trash
                  {trashedProjects.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-amber-500/15 text-amber-400 font-semibold">
                      {trashedProjects.length}
                    </span>
                  )}
                </button>
              </div>

              {isLoadingProjects ? (
                <div className="p-8 text-center text-xs text-cs-text-tertiary">
                  Scanning workspace projects…
                </div>
              ) : activeWorkspaceTab === "projects" ? (
                projects.length === 0 ? (
                  <EmptyState
                    icon={
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                        <rect x="2" y="6" width="20" height="12" rx="2" />
                        <path d="M7 6v12M17 6v12M2 10h20M2 14h20" />
                      </svg>
                    }
                    title="No projects in this workspace"
                    description="Create a project to start importing local video clips and editing."
                    action={
                      <Button
                        variant="primary"
                        size="md"
                        onClick={() => {
                          setNewProjectName("Untitled Project");
                          setIsCreateModalOpen(true);
                        }}
                      >
                        Create project
                      </Button>
                    }
                  />
                ) : (
                  <ul role="list" className="divide-y divide-cs-border-subtle" aria-label="Workspace projects">
                    {projects.map((proj) => (
                      <li
                        key={proj.id}
                        className="flex items-center justify-between gap-4 p-4 hover:bg-cs-bg-elevated/40 transition-colors"
                      >
                        {/* Left: Project title & metadata */}
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded bg-cs-bg-muted border border-cs-border-subtle flex items-center justify-center text-cs-text-secondary shrink-0 mt-0.5">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                              <rect x="2" y="6" width="20" height="12" rx="2" />
                              <path d="M7 6v12M17 6v12M2 10h20M2 14h20" />
                            </svg>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => handleOpenProject(proj.id)}
                                disabled={!proj.valid || openingProjectId === proj.id}
                                className="text-sm font-semibold text-cs-text-primary hover:text-cs-accent truncate text-left cursor-pointer disabled:cursor-not-allowed"
                              >
                                {proj.name}
                              </button>
                              {!proj.valid && (
                                <Badge variant="error" title={proj.error}>
                                  Unreadable
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-cs-text-tertiary mt-1">
                              <span>{proj.assetCount} media reference{proj.assetCount === 1 ? "" : "s"}</span>
                              <span>·</span>
                              <span>Updated {new Date(proj.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>

                        {/* Right: Actions */}
                        <div className="flex items-center gap-2 shrink-0">
                          {proj.valid ? (
                            <>
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => handleOpenProject(proj.id)}
                                disabled={openingProjectId === proj.id}
                              >
                                {openingProjectId === proj.id ? "Opening…" : "Open"}
                              </Button>
                              <IconButton
                                label="Rename project"
                                size="sm"
                                onClick={() => {
                                  setProjectToRename(proj);
                                  setRenameInputVal(proj.name);
                                }}
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </IconButton>
                            </>
                          ) : null}

                          <IconButton
                            label="Move project to trash"
                            size="sm"
                            onClick={() => setProjectToDelete(proj)}
                            className="hover:text-cs-error"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" strokeWidth="2" stroke="currentColor">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </IconButton>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : (
                /* Trash View */
                trashedProjects.length === 0 ? (
                  <EmptyState
                    icon={
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" strokeWidth="1.3" stroke="currentColor">
                        <polyline points="3 6 5 6 21 6" />
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                      </svg>
                    }
                    title="Trash is empty"
                    description="Deleted projects are moved here first. You can restore them or permanently remove them."
                  />
                ) : (
                  <ul role="list" className="divide-y divide-cs-border-subtle" aria-label="Trashed projects">
                    {trashedProjects.map((proj) => (
                      <li
                        key={proj.id}
                        className="flex items-center justify-between gap-4 p-4 hover:bg-cs-bg-elevated/40 transition-colors"
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="w-8 h-8 rounded bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shrink-0 mt-0.5">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" strokeWidth="1.8" stroke="currentColor">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </div>

                          <div className="flex flex-col min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-cs-text-primary truncate">
                                {proj.name}
                              </span>
                              <Badge variant="warning">Trashed</Badge>
                            </div>
                            <div className="flex items-center gap-2 text-xs text-cs-text-tertiary mt-1">
                              <span>{proj.assetCount} media reference{proj.assetCount === 1 ? "" : "s"}</span>
                              <span>·</span>
                              <span>Last modified {new Date(proj.updatedAt).toLocaleDateString()}</span>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => handleRestoreProject(proj.id)}
                            disabled={isRestoringFromTrash}
                          >
                            Restore
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => setProjectToPermanentDelete(proj)}
                            disabled={isPermanentlyDeleting}
                          >
                            Delete permanently
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </Panel>
          </>
        )}

        {/* Feature highlights */}
        <FeaturesSection />

        {/* Browser compatibility */}
        <section aria-labelledby="compat-heading">
          <SectionLabel id="compat-heading" className="block mb-3 px-1">
            Browser capabilities
          </SectionLabel>
          <BrowserCompatibility />
        </section>
      </div>

      {/* ─── Create Project Dialog ────────────────────────────────────────── */}
      <Modal
        open={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        title="Create New Project"
        description="Creates a durable project document inside projects/<uuid>/ in your workspace."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsCreateModalOpen(false)}
              disabled={isCreatingProject}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => handleCreateProjectSubmit()}
              disabled={isCreatingProject || !newProjectName.trim()}
            >
              {isCreatingProject ? "Creating…" : "Create project"}
            </Button>
          </>
        }
      >
        <form onSubmit={handleCreateProjectSubmit}>
          <Input
            label="Project name"
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="e.g. YouTube Video, Podcast Episode 4"
            autoFocus
            maxLength={100}
          />
        </form>
      </Modal>

      {/* ─── Rename Project Dialog ────────────────────────────────────────── */}
      <Modal
        open={projectToRename !== null}
        onClose={() => setProjectToRename(null)}
        title="Rename Project"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setProjectToRename(null)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={() => handleRenameProjectSubmit()}>
              Save name
            </Button>
          </>
        }
      >
        <form onSubmit={handleRenameProjectSubmit}>
          <Input
            label="Project name"
            value={renameInputVal}
            onChange={(e) => setRenameInputVal(e.target.value)}
            autoFocus
            maxLength={100}
          />
        </form>
      </Modal>

      {/* ─── Move Project to Trash Confirmation Dialog (Phase 6) ───────────── */}
      <Modal
        open={projectToDelete !== null}
        onClose={() => setProjectToDelete(null)}
        title="Move Project to Trash"
        description="The project will be moved to the workspace trash and can be restored at any time. Original source media is never deleted."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setProjectToDelete(null)}
              disabled={isDeletingProject}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteProjectSubmit}
              disabled={isDeletingProject}
            >
              {isDeletingProject ? "Moving…" : "Move to trash"}
            </Button>
          </>
        }
      >
        {projectToDelete && (
          <div className="flex flex-col gap-3 text-xs text-cs-text-secondary leading-relaxed">
            <p>
              Are you sure you want to move <strong className="text-cs-text-primary">{projectToDelete.name}</strong> to the workspace trash?
            </p>
            <div className="p-3 rounded bg-cs-bg-base border border-cs-border-subtle flex flex-col gap-1 text-[11px]">
              <span className="text-cs-text-tertiary">Path to move:</span>
              <span className="font-mono text-cs-text-secondary break-all">
                projects/{projectToDelete.id}/ → trash/{projectToDelete.id}/
              </span>
            </div>
            <p className="text-cs-text-tertiary">
              <strong>Your original video and audio files will NOT be touched.</strong> You can restore this project anytime from the Trash tab.
            </p>
          </div>
        )}
      </Modal>

      {/* ─── Permanent Delete Confirmation Dialog (Phase 6) ────────────────── */}
      <Modal
        open={projectToPermanentDelete !== null}
        onClose={() => setProjectToPermanentDelete(null)}
        title="Permanently Delete Project"
        description="This action is permanent and cannot be undone. Only application-managed project files in the trash will be deleted."
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setProjectToPermanentDelete(null)}
              disabled={isPermanentlyDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handlePermanentDeleteSubmit}
              disabled={isPermanentlyDeleting}
            >
              {isPermanentlyDeleting ? "Deleting…" : "Delete permanently"}
            </Button>
          </>
        }
      >
        {projectToPermanentDelete && (
          <div className="flex flex-col gap-3 text-xs text-cs-text-secondary leading-relaxed">
            <p>
              Permanently delete <strong className="text-cs-text-primary">{projectToPermanentDelete.name}</strong> from trash?
            </p>
            <div className="p-3 rounded bg-cs-error/10 border border-cs-error/20 text-cs-error text-[11px] space-y-1">
              <p className="font-semibold">Irreversible Action</p>
              <p>
                All snapshots and export records for this project in <code>trash/{projectToPermanentDelete.id}/</code> will be permanently removed.
              </p>
            </div>
            <p className="text-cs-text-tertiary">
              <strong>Your original camera/source media files will NOT be deleted or altered.</strong>
            </p>
          </div>
        )}
      </Modal>

      {/* ─── Workspace Cache Management Modal (Phase 6) ──────────────────── */}
      {workspaceHandle && (
        <CacheManagerModal
          isOpen={isCacheModalOpen}
          workspaceHandle={workspaceHandle}
          onClose={() => setIsCacheModalOpen(false)}
        />
      )}
    </div>
  );
}
