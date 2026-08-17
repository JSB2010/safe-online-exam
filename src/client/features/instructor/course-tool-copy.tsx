import { AlertCircle, Copy, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { ExternalToolConfig } from "../../../shared/models.js";
import { normalizeCourseExternalTools } from "../../../shared/models.js";
import { actionHeaders, apiMessage, errorMessage, redirectForAuth, requestJson } from "../../lib/api.js";
import { useDialogInitialFocus, useEscapeToClose } from "../../hooks/dialog.js";
import { CourseToolCopyCourse, CourseToolCopyResult } from "../../types.js";

export function CourseToolCopyDialog({
  courseId,
  authToken,
  tool,
  onClose
}: {
  courseId: string;
  authToken?: string;
  tool: ExternalToolConfig;
  onClose: () => void;
}) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useEscapeToClose(onClose);
  useDialogInitialFocus(closeButtonRef);
  const [courses, setCourses] = useState<CourseToolCopyCourse[]>([]);
  const [selectedCourseIds, setSelectedCourseIds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(true);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CourseToolCopyResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadCourses() {
      setLoading(true);
      setError(null);
      try {
        const body = await requestJson(
          `/api/quizzes/course/${encodeURIComponent(courseId)}/exam-tools/${encodeURIComponent(tool.id)}/copy-targets`,
          { headers: actionHeaders(authToken) }
        );
        if (redirectForAuth(body) || cancelled) return;
        if (!body.success || !Array.isArray(body.courses)) {
          setError(apiMessage(body, "Instructor courses could not be loaded."));
          return;
        }
        setCourses(
          body.courses.flatMap((course: unknown) => {
            if (!course || typeof course !== "object") return [];
            const candidate = course as Record<string, unknown>;
            return typeof candidate.courseId === "string" && typeof candidate.name === "string"
              ? [
                  {
                    courseId: candidate.courseId,
                    name: candidate.name,
                    courseCode: typeof candidate.courseCode === "string" ? candidate.courseCode : null
                  }
                ]
              : [];
          })
        );
      } catch (loadError) {
        if (!cancelled) {
          setError(errorMessage(loadError, "Instructor courses could not be loaded."));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadCourses();
    return () => {
      cancelled = true;
    };
  }, [authToken, courseId, tool.id]);

  const allSelected = courses.length > 0 && selectedCourseIds.size === courses.length;
  const selectedCount = selectedCourseIds.size;
  const toggleCourse = (targetCourseId: string) => {
    setSelectedCourseIds((current) => {
      const next = new Set(current);
      if (next.has(targetCourseId)) {
        next.delete(targetCourseId);
      } else {
        next.add(targetCourseId);
      }
      return next;
    });
  };
  const toggleAllCourses = () => {
    setSelectedCourseIds(allSelected ? new Set() : new Set(courses.map((course) => course.courseId)));
  };

  async function copy() {
    setCopying(true);
    setError(null);
    try {
      const body = await requestJson(
        `/api/quizzes/course/${encodeURIComponent(courseId)}/exam-tools/${encodeURIComponent(tool.id)}/copy`,
        {
          method: "POST",
          headers: { "content-type": "application/json", ...actionHeaders(authToken) },
          body: JSON.stringify({ courseIds: Array.from(selectedCourseIds) })
        }
      );
      if (redirectForAuth(body)) return;
      if (!Array.isArray(body.copied) || !Array.isArray(body.alreadyPresent) || !Array.isArray(body.failed)) {
        setError(apiMessage(body, "This exam tool could not be copied."));
        return;
      }
      setResult({
        copied: copyResultCourses(body.copied),
        alreadyPresent: copyResultCourses(body.alreadyPresent),
        failed: copyResultCourses(body.failed).map((course, index) => {
          const raw = body.failed[index];
          return {
            ...course,
            errorCode: raw && typeof raw === "object" && typeof raw.errorCode === "string" ? raw.errorCode : undefined
          };
        })
      });
    } catch (copyError) {
      setError(errorMessage(copyError, "This exam tool could not be copied."));
    } finally {
      setCopying(false);
    }
  }

  const copiedCount = result?.copied.length || 0;
  const existingCount = result?.alreadyPresent.length || 0;
  const failedCount = result?.failed.length || 0;
  return (
    <div className="dialog-backdrop course-tool-copy-backdrop" role="presentation">
      <section
        className="dialog course-tool-copy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-tool-title"
      >
        <header className="dialog-header">
          <div>
            <span className="section-kicker">Duplicate exam tool</span>
            <h2 id="copy-tool-title">Copy {tool.label || "exam tool"}</h2>
          </div>
          <button
            ref={closeButtonRef}
            className="icon-button"
            type="button"
            onClick={onClose}
            title="Close duplicate exam tool"
            aria-label="Close duplicate exam tool"
          >
            <X size={17} />
          </button>
        </header>
        {result ? (
          <div className="course-copy-result" aria-live="polite">
            <p>
              {copiedCount > 0
                ? `Added to ${copiedCount} ${copiedCount === 1 ? "course" : "courses"}.`
                : "No new copies were needed."}
            </p>
            {existingCount > 0 && (
              <small>
                Already up to date in {existingCount} {existingCount === 1 ? "course" : "courses"}.
              </small>
            )}
            {failedCount > 0 && (
              <div className="notice error">
                <AlertCircle size={17} /> Could not add this tool to {failedCount}{" "}
                {failedCount === 1 ? "course" : "courses"}.
                {result.failed.some((course) => course.errorCode === "COURSE_TOOL_LIMIT")
                  ? " Remove an existing tool in those courses, then try again."
                  : " Try again in a moment."}
              </div>
            )}
          </div>
        ) : loading ? (
          <p className="empty-line" aria-live="polite">
            Loading your instructor courses…
          </p>
        ) : (
          <div className="course-copy-picker">
            <div className="course-copy-picker-header">
              <div>
                <strong>Choose destination courses</strong>
                <small>Canvas verifies your instructor access again before the tool is added.</small>
              </div>
              {courses.length > 0 && (
                <label className="course-copy-select-all">
                  <input type="checkbox" checked={allSelected} onChange={toggleAllCourses} />
                  <span>Select all</span>
                </label>
              )}
            </div>
            {courses.length > 0 ? (
              <div className="course-copy-list">
                {courses.map((course) => (
                  <label className="course-copy-option" key={course.courseId}>
                    <input
                      type="checkbox"
                      checked={selectedCourseIds.has(course.courseId)}
                      onChange={() => toggleCourse(course.courseId)}
                    />
                    <span>
                      <strong>{course.name}</strong>
                      {course.courseCode && <small>{course.courseCode}</small>}
                    </span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="empty-line">Canvas did not find another active course where you are a teacher.</p>
            )}
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            <AlertCircle size={17} /> {error}
          </div>
        )}
        <footer className="dialog-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            {result ? "Done" : "Cancel"}
          </button>
          {!result && (
            <button
              className="button primary"
              type="button"
              disabled={loading || copying || selectedCount === 0}
              onClick={() => void copy()}
            >
              <Copy size={16} />
              {copying ? "Copying…" : `Duplicate to ${selectedCount} ${selectedCount === 1 ? "course" : "courses"}`}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}

function copyResultCourses(value: unknown[]): CourseToolCopyCourse[] {
  return value.flatMap((course) => {
    if (!course || typeof course !== "object") return [];
    const candidate = course as Record<string, unknown>;
    return typeof candidate.courseId === "string" && typeof candidate.name === "string"
      ? [
          {
            courseId: candidate.courseId,
            name: candidate.name,
            courseCode: typeof candidate.courseCode === "string" ? candidate.courseCode : null
          }
        ]
      : [];
  });
}

export function courseToolCopySignature(tool: ExternalToolConfig): string {
  const [normalized] = normalizeCourseExternalTools([tool]);
  return JSON.stringify(normalized || null);
}
