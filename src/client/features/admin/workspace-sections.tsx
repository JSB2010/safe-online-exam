import {
  BookOpen,
  Calculator,
  ChevronDown,
  Eye,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldCheck,
  Trash2,
  Unlock
} from "lucide-react";
import clsx from "clsx";
import { SecretPanel } from "./secret-panel.js";
import type { AdminCourseView, AdminOverview, AdminToolPresetView, RevealedSecrets } from "../../types.js";

interface AdminCoursesSectionProps {
  overview: AdminOverview | null;
  loading: boolean;
  courses: AdminCourseView[];
  selectedCourseId: string;
  selectedCourse: AdminCourseView | null;
  query: string;
  includePast: boolean;
  revealed: Record<string, RevealedSecrets>;
  isBusy: (key: string) => boolean;
  onConnect: () => void;
  onQuery: (value: string) => void;
  onIncludePast: (value: boolean) => void;
  onOperationalTerm: (termId: string) => void;
  onSelectCourse: (courseId: string) => void;
  onLoadMore: () => void;
  onReveal: (key: string, url: string) => void;
  onRotateCourseQuitPassword: (course: AdminCourseView) => void;
  onMutate: (key: string, url: string, init: RequestInit, successMessage: string) => void;
  onResetCourse: (course: AdminCourseView) => void;
}

export function AdminCoursesSection({
  overview,
  loading,
  courses,
  selectedCourseId,
  selectedCourse,
  query,
  includePast,
  revealed,
  isBusy,
  onConnect,
  onQuery,
  onIncludePast,
  onOperationalTerm,
  onSelectCourse,
  onLoadMore,
  onReveal,
  onRotateCourseQuitPassword,
  onMutate,
  onResetCourse
}: AdminCoursesSectionProps) {
  return (
    <section
      className="work-surface admin-surface"
      id="admin-panel-courses"
      role="tabpanel"
      aria-labelledby="admin-tab-courses"
    >
      <aside className="admin-course-sidebar">
        <div className="admin-sidebar-heading">
          <div>
            <span className="section-kicker">Safe Online Exam</span>
            <h2>Configured courses</h2>
          </div>
          <button className="button primary small" type="button" onClick={onConnect}>
            <Plus size={14} /> Connect
          </button>
        </div>
        <div className="search admin-search">
          <Search size={17} />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search name, code, teacher, term, or ID"
            aria-label="Search configured courses"
          />
        </div>
        <div className="admin-course-scope-controls">
          <label>
            Operational term
            <select
              value={overview?.operationalTerm?.id || ""}
              disabled={isBusy("operational-term") || !overview?.terms?.length}
              onChange={(event) => onOperationalTerm(event.target.value)}
            >
              {!overview?.terms?.length && <option value="">No active Canvas terms</option>}
              {(overview?.terms || []).map((term) => (
                <option value={term.id} key={term.id}>
                  {term.name}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox-line compact">
            <input type="checkbox" checked={includePast} onChange={(event) => onIncludePast(event.target.checked)} />
            Show past and other courses
          </label>
        </div>
        <div className="admin-course-list">
          {loading && !overview && (
            <div className="admin-loading">
              <RefreshCw className="spin" size={18} /> Loading configured courses…
            </div>
          )}
          {!loading && !courses.length && (
            <div className="empty-line">
              {query
                ? "No matching configured courses."
                : includePast
                  ? "No courses have configured Safe Online Exam yet."
                  : "No configured courses are active in the operational term."}
            </div>
          )}
          {courses.map((course) => (
            <button
              key={course.id}
              type="button"
              className={clsx("admin-course-row", selectedCourseId === course.id && "selected")}
              onClick={() => onSelectCourse(course.id)}
            >
              <span>
                <strong>{course.name}</strong>
                <small>{course.courseCode || `Course ${course.id}`}</small>
              </span>
              <span
                className={clsx("admin-count", course.enabledAssessmentCount > 0 && "active")}
                title={`${course.enabledAssessmentCount} of ${course.assessmentCount} assessments require Safe Online Exam`}
              >
                {course.enabledAssessmentCount}/{course.assessmentCount}
              </span>
            </button>
          ))}
          {!!overview?.nextCourseCursor && (
            <button
              className="button secondary admin-load-more"
              type="button"
              disabled={isBusy("courses:more")}
              onClick={onLoadMore}
            >
              <ChevronDown size={15} /> {isBusy("courses:more") ? "Loading…" : "Load more courses"}
            </button>
          )}
        </div>
      </aside>

      <div className="admin-course-detail">
        {selectedCourse ? (
          <>
            <div className="admin-detail-header">
              <div>
                <span className="section-kicker">Course {selectedCourse.id}</span>
                <h2>{selectedCourse.name}</h2>
                <p>
                  {selectedCourse.courseCode || "No course code"} · {selectedCourse.workflowState || "unknown state"}
                </p>
              </div>
              <div className="admin-detail-actions">
                <button
                  className="button secondary compact"
                  type="button"
                  disabled={isBusy(`course:${selectedCourse.id}`)}
                  onClick={() =>
                    onReveal(
                      `course:${selectedCourse.id}`,
                      `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/passwords/reveal`
                    )
                  }
                >
                  <KeyRound size={15} /> Course passwords
                </button>
                <button
                  className="button secondary compact"
                  type="button"
                  disabled={isBusy(`rotate-password:${selectedCourse.id}`)}
                  onClick={() => onRotateCourseQuitPassword(selectedCourse)}
                >
                  <RefreshCw size={15} /> Rotate exit password
                </button>
                <button
                  className="button primary compact"
                  type="button"
                  disabled={isBusy(`refresh:${selectedCourse.id}`)}
                  onClick={() =>
                    onMutate(
                      `refresh:${selectedCourse.id}`,
                      `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/refresh`,
                      { method: "POST" },
                      "Course content refreshed from Canvas."
                    )
                  }
                >
                  <RefreshCw className={isBusy(`refresh:${selectedCourse.id}`) ? "spin" : ""} size={15} /> Refresh
                  course
                </button>
                <button
                  className="button danger compact"
                  type="button"
                  disabled={isBusy(`reset-course:${selectedCourse.id}`)}
                  onClick={() => onResetCourse(selectedCourse)}
                >
                  <Trash2 size={15} /> Reset course
                </button>
              </div>
            </div>
            <SecretPanel secret={revealed[`course:${selectedCourse.id}`]} />
            {!!overview?.toolPresets?.length && (
              <section className="admin-course-presets">
                <div className="admin-course-presets-heading">
                  <div>
                    <strong>Approved tools for this course</strong>
                    <small>Assigned tools are available to instructors course-wide and for individual quizzes.</small>
                  </div>
                  <span>
                    {selectedCourse.adminToolPresetIds?.length || 0} of {overview.toolPresets.length} assigned
                  </span>
                </div>
                <div className="admin-course-preset-list">
                  {overview.toolPresets.map((preset) => {
                    const assigned = selectedCourse.adminToolPresetIds?.includes(preset.id) === true;
                    return (
                      <label className={clsx("admin-course-preset-option", assigned && "assigned")} key={preset.id}>
                        <input
                          type="checkbox"
                          checked={assigned}
                          disabled={isBusy(`assign-preset:${preset.id}`)}
                          onChange={(event) =>
                            onMutate(
                              `assign-preset:${preset.id}`,
                              `/api/admin/tool-presets/${encodeURIComponent(preset.id)}/courses/${encodeURIComponent(selectedCourse.id)}`,
                              { method: "PUT", body: JSON.stringify({ assigned: event.target.checked }) },
                              event.target.checked
                                ? `${preset.name} is now available in this course.`
                                : `${preset.name} was removed from this course.`
                            )
                          }
                        />
                        <span className="admin-course-preset-icon">
                          <Calculator size={16} />
                        </span>
                        <span className="admin-course-preset-copy">
                          <strong>{preset.name}</strong>
                          <small>{preset.tool.url}</small>
                        </span>
                        <span className={clsx("admin-assignment-state", assigned && "assigned")}>
                          {assigned ? "Assigned" : "Available"}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}
            <div className="admin-assessment-heading">
              <div>
                <h3>Assessments</h3>
              </div>
              <span>
                {selectedCourse.enabledAssessmentCount} active · {selectedCourse.assessmentCount} total
              </span>
            </div>
            <div className="admin-assessment-list">
              {(selectedCourse.assessments || []).map((assessment) => {
                const route = `/api/admin/courses/${encodeURIComponent(selectedCourse.id)}/assessments/${encodeURIComponent(assessment.id)}`;
                const secretKey = `assessment:${assessment.id}`;
                return (
                  <article
                    className={clsx("admin-assessment-row", assessment.sebRequired && "enabled")}
                    key={assessment.id}
                  >
                    <div className="admin-assessment-main">
                      <span className="assessment-icon" aria-hidden="true">
                        <BookOpen size={16} />
                      </span>
                      <div>
                        <strong>{assessment.title}</strong>
                        <small>
                          {assessment.contentType === "NEW_QUIZ" ? "New Quiz" : "Classic Quiz"} ·{" "}
                          {assessment.published ? "Published" : "Unpublished"}
                        </small>
                      </div>
                    </div>
                    <div className="admin-assessment-actions">
                      <span className={clsx("status-pill", assessment.sebRequired ? "enabled" : "disabled")}>
                        {assessment.sebRequired ? <ShieldCheck size={13} /> : <Shield size={13} />}
                        {assessment.sebRequired ? "Requires Safe Exam Browser" : "Browser not required"}
                      </span>
                      {assessment.sebRequired ? (
                        <>
                          <button
                            className="button secondary compact"
                            type="button"
                            disabled={isBusy(secretKey)}
                            onClick={() => onReveal(secretKey, `${route}/passwords/reveal`)}
                          >
                            <Eye size={15} /> Reveal passwords
                          </button>
                          <button
                            className="button secondary compact"
                            type="button"
                            disabled={isBusy(`reset:${assessment.id}`)}
                            onClick={() =>
                              onMutate(
                                `reset:${assessment.id}`,
                                `${route}/reset-defaults`,
                                { method: "POST" },
                                "Assessment reset to the course defaults."
                              )
                            }
                          >
                            <RefreshCw size={15} /> Reset settings
                          </button>
                          <button
                            className="button secondary compact"
                            type="button"
                            disabled={isBusy(`reset-password:${assessment.id}`)}
                            onClick={() =>
                              window.confirm(
                                "Reset this assessment’s exit password to the current course or managed default?"
                              ) &&
                              onMutate(
                                `reset-password:${assessment.id}`,
                                `${route}/quit-password/reset`,
                                { method: "POST" },
                                "Assessment exit password reset to the course default."
                              )
                            }
                          >
                            <KeyRound size={15} /> Reset exit password
                          </button>
                          <button
                            className="button secondary compact"
                            type="button"
                            disabled={isBusy(`code:${assessment.id}`)}
                            onClick={() =>
                              onMutate(
                                `code:${assessment.id}`,
                                `${route}/regenerate-code`,
                                { method: "POST" },
                                "Canvas access code rotated."
                              )
                            }
                          >
                            <KeyRound size={15} /> Rotate access code
                          </button>
                          <button
                            className="button danger compact"
                            type="button"
                            disabled={isBusy(`seb:${assessment.id}`)}
                            onClick={() =>
                              onMutate(
                                `seb:${assessment.id}`,
                                `${route}/seb`,
                                { method: "PUT", body: JSON.stringify({ required: false }) },
                                "Safe Online Exam disabled for this assessment."
                              )
                            }
                          >
                            <Unlock size={15} /> Disable
                          </button>
                        </>
                      ) : (
                        <button
                          className="button primary compact"
                          type="button"
                          disabled={isBusy(`seb:${assessment.id}`)}
                          onClick={() =>
                            onMutate(
                              `seb:${assessment.id}`,
                              `${route}/seb`,
                              { method: "PUT", body: JSON.stringify({ required: true }) },
                              "Safe Online Exam enabled for this assessment."
                            )
                          }
                        >
                          <Lock size={15} /> Enable Safe Online Exam
                        </button>
                      )}
                    </div>
                    {assessment.sebRequired && <SecretPanel secret={revealed[secretKey]} compact />}
                  </article>
                );
              })}
              {!selectedCourse.assessments?.length && (
                <div className="empty-state">
                  <BookOpen size={28} />
                  <strong>No synced assessments</strong>
                  <span>Refresh this course to discover Classic Quizzes and New Quizzes.</span>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="empty-state">
            <BookOpen size={30} />
            <strong>Select a course</strong>
            <span>Choose a Canvas course to inspect its Safe Online Exam configuration.</span>
          </div>
        )}
      </div>
    </section>
  );
}

interface AdminInstitutionSectionProps {
  presets: AdminToolPresetView[];
  isBusy: (key: string) => boolean;
  onCreate: () => void;
  onRollout: (preset: AdminToolPresetView) => void;
  onRetry: (presetId: string) => void;
  onEdit: (preset: AdminToolPresetView) => void;
  onDelete: (preset: AdminToolPresetView) => void;
}

export function AdminInstitutionSection({
  presets,
  isBusy,
  onCreate,
  onRollout,
  onRetry,
  onEdit,
  onDelete
}: AdminInstitutionSectionProps) {
  return (
    <section
      className="work-surface admin-settings-surface"
      id="admin-panel-institution"
      role="tabpanel"
      aria-labelledby="admin-tab-institution"
    >
      <div className="admin-page-heading">
        <div>
          <span className="section-kicker">Institution-wide settings</span>
          <h2>Approved exam tools</h2>
          <p>Define trusted launch URLs and resource rules once, then assign each tool to the courses that need it.</p>
        </div>
        <button className="button primary compact" type="button" onClick={onCreate}>
          <Plus size={15} /> New exam tool
        </button>
      </div>
      <div className="admin-settings-section-heading">
        <div className="admin-settings-icon">
          <Calculator size={18} />
        </div>
        <div>
          <strong>Exam tool library</strong>
          <small>Instructors can use assigned tools without entering domains or URL rules themselves.</small>
        </div>
        <span>{presets.length} tools</span>
      </div>
      <div className="admin-preset-grid">
        {presets.map((preset) => (
          <article className="admin-preset-card" key={preset.id}>
            <div className="admin-preset-card-header">
              <span className="admin-preset-icon">
                <Calculator size={18} />
              </span>
              <div>
                <strong>{preset.name}</strong>
                <small>{preset.description || "No description"}</small>
              </div>
            </div>
            <div className="admin-preset-url">
              <span>Launch URL</span>
              <code title={preset.tool.url}>{preset.tool.url}</code>
            </div>
            <footer className="admin-preset-card-footer">
              <div className="admin-preset-rollout-status">
                <span>
                  <BookOpen size={14} />
                  Assigned to {preset.assignedCourseCount} course{preset.assignedCourseCount === 1 ? "" : "s"}
                </span>
                {!!preset.pendingAssignmentCount && <small>{preset.pendingAssignmentCount} pending</small>}
                {!!preset.failedAssignmentCount && (
                  <small className="error">{preset.failedAssignmentCount} need retry</small>
                )}
              </div>
              <div className="admin-preset-actions">
                <button className="button primary compact" type="button" onClick={() => onRollout(preset)}>
                  <BookOpen size={15} /> Assign courses
                </button>
                {!!preset.failedAssignmentCount && (
                  <button
                    className="button secondary compact"
                    type="button"
                    disabled={isBusy(`retry-preset:${preset.id}`)}
                    onClick={() => onRetry(preset.id)}
                  >
                    <RefreshCw size={15} /> Retry
                  </button>
                )}
                <button className="button secondary compact" type="button" onClick={() => onEdit(preset)}>
                  <Settings size={15} /> Edit
                </button>
                <button
                  className="button secondary danger compact"
                  type="button"
                  disabled={isBusy(`delete-preset:${preset.id}`)}
                  onClick={() => onDelete(preset)}
                >
                  <Trash2 size={15} /> Delete
                </button>
              </div>
            </footer>
          </article>
        ))}
        {!presets.length && (
          <div className="empty-state admin-settings-empty">
            <Calculator size={30} />
            <strong>No approved exam tools</strong>
            <span>Create a tool for services such as Desmos or GeoGebra, then assign it from a course.</span>
            <button className="button primary compact" type="button" onClick={onCreate}>
              <Plus size={15} /> Create first exam tool
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
