import { trace, context, ROOT_CONTEXT, SpanStatusCode, type Span } from "@opentelemetry/api";
import { NodeTracerProvider, BatchSpanProcessor } from "@opentelemetry/sdk-trace-node";
import { TraceExporter } from "@google-cloud/opentelemetry-cloud-trace-exporter";
import { diagnostics } from "./runtime.js";
let provider: NodeTracerProvider | undefined;
export function startDiagnosticTracing() {
  if (!diagnostics.settings.enabled || process.env.DIAGNOSTICS_OTEL_ENABLED !== "true") return;
  provider = new NodeTracerProvider({
    spanProcessors: [
      new BatchSpanProcessor(new TraceExporter({ projectId: process.env.GOOGLE_CLOUD_PROJECT }), {
        maxQueueSize: 512,
        maxExportBatchSize: 64,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 5000
      })
    ]
  });
  provider.register();
  return provider;
}
export async function diagnosticSpan<T>(name: string, run: () => Promise<T>): Promise<T> {
  if (!provider || !diagnostics.active(diagnostics.current()?.courseId)) return run();
  return trace.getTracer("soe.diagnostics", "1.2.0").startActiveSpan(name, async (span) => {
    try {
      const result = await run();
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw error;
    } finally {
      span.end();
    }
  });
}
export function requestSpan(
  route: string | undefined,
  traceId: string | undefined,
  callback: (span?: Span) => void,
  parentSpanId?: string
) {
  if (!provider || !route) {
    callback();
    return;
  }
  const parent =
    traceId && parentSpanId
      ? trace.setSpanContext(ROOT_CONTEXT, { traceId, spanId: parentSpanId, traceFlags: 1, isRemote: true })
      : context.active();
  trace
    .getTracer("soe.diagnostics", "1.2.0")
    .startActiveSpan("http.request", { attributes: { "http.route": route } }, parent, (span) => callback(span));
}
