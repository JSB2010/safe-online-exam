#!/usr/bin/env node

import { FieldValue, Firestore } from "@google-cloud/firestore";
import { Buffer } from "node:buffer";
import console from "node:console";
import process from "node:process";
import { pathToFileURL } from "node:url";

export const LEGACY_METADATA_FIELD = "canvas.metadata";
export const NEW_QUIZ_CONTENT_TYPE = "NEW_QUIZ";
const DEFAULT_ASSESSMENTS_COLLECTION = "assessments";
const DEFAULT_BATCH_SIZE = 400;
const MAX_BATCH_SIZE = 500;

export function parseMigrationArguments(argv) {
  const allowed = new Set(["--apply", "--help", "-h"]);
  const unknown = argv.filter((argument) => !allowed.has(argument));
  if (unknown.length > 0) {
    throw new Error(`Unknown argument: ${unknown[0]}`);
  }
  if (argv.filter((argument) => argument === "--apply").length > 1) {
    throw new Error("--apply may be supplied only once");
  }
  return {
    apply: argv.includes("--apply"),
    help: argv.includes("--help") || argv.includes("-h")
  };
}

export function resolveMigrationTarget(env) {
  const projectId = requireExplicitTarget(env.GCP_PROJECT_ID, "GCP_PROJECT_ID");
  const databaseId = requireExplicitTarget(env.FIRESTORE_DATABASE_ID, "FIRESTORE_DATABASE_ID");
  const assessmentsCollection = (env.FIRESTORE_ASSESSMENTS_COLLECTION || DEFAULT_ASSESSMENTS_COLLECTION).trim();

  if (!isSingleFirestorePathSegment(assessmentsCollection)) {
    throw new Error("FIRESTORE_ASSESSMENTS_COLLECTION must be one nonempty Firestore collection path segment");
  }

  return { projectId, databaseId, assessmentsCollection };
}

export function buildMigrationPlan(argv, env) {
  const options = parseMigrationArguments(argv);
  if (options.help) {
    return { ...options };
  }
  return {
    ...options,
    ...resolveMigrationTarget(env)
  };
}

export function stageMetadataFieldDeletion(batch, documentReference, deleteValue = FieldValue.delete()) {
  batch.update(documentReference, LEGACY_METADATA_FIELD, deleteValue);
}

export async function migrateLegacyNewQuizMetadata(firestore, plan, options = {}) {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_BATCH_SIZE) {
    throw new Error(`Migration batch size must be an integer from 1 through ${MAX_BATCH_SIZE}`);
  }

  const snapshot = await firestore
    .collection(plan.assessmentsCollection)
    .where("contentType", "==", NEW_QUIZ_CONTENT_TYPE)
    .select(LEGACY_METADATA_FIELD)
    .get();
  const summary = {
    mode: plan.apply ? "apply" : "dry-run",
    scanned: 0,
    matched: 0,
    updated: 0,
    batches: 0
  };
  let pendingReferences = [];

  const commitPending = async () => {
    if (pendingReferences.length === 0) {
      return;
    }
    const batch = firestore.batch();
    const deleteValue = options.deleteValue ?? FieldValue.delete();
    for (const reference of pendingReferences) {
      stageMetadataFieldDeletion(batch, reference, deleteValue);
    }
    await batch.commit();
    summary.updated += pendingReferences.length;
    summary.batches += 1;
    pendingReferences = [];
  };

  for (const documentSnapshot of snapshot.docs) {
    summary.scanned += 1;
    if (documentSnapshot.get(LEGACY_METADATA_FIELD) === undefined) {
      continue;
    }
    summary.matched += 1;
    if (!plan.apply) {
      continue;
    }
    pendingReferences.push(documentSnapshot.ref);
    if (pendingReferences.length >= batchSize) {
      await commitPending();
    }
  }

  await commitPending();
  return summary;
}

export function migrationUsage() {
  return [
    "Usage:",
    "  GCP_PROJECT_ID=PROJECT FIRESTORE_DATABASE_ID=DATABASE npm run security:purge-new-quiz-metadata",
    "  GCP_PROJECT_ID=PROJECT FIRESTORE_DATABASE_ID=DATABASE npm run security:purge-new-quiz-metadata -- --apply",
    "",
    "The command is a dry run unless --apply is supplied. It reads only canvas.metadata and never prints document contents.",
    "FIRESTORE_ASSESSMENTS_COLLECTION may override the default assessments collection."
  ].join("\n");
}

async function main() {
  const plan = buildMigrationPlan(process.argv.slice(2), process.env);
  if (plan.help) {
    console.log(migrationUsage());
    return;
  }

  console.log("Legacy New Quiz metadata cleanup");
  console.log(`Mode: ${plan.apply ? "APPLY" : "DRY RUN"}`);
  console.log(`Project: ${plan.projectId}`);
  console.log(`Database: ${plan.databaseId}`);
  console.log(`Collection: ${plan.assessmentsCollection}`);

  const firestore = new Firestore({ projectId: plan.projectId, databaseId: plan.databaseId });
  try {
    const summary = await migrateLegacyNewQuizMetadata(firestore, plan);
    console.log(`Scanned: ${summary.scanned}`);
    console.log(`Matched: ${summary.matched}`);
    console.log(`Updated: ${summary.updated}`);
    console.log(`Committed batches: ${summary.batches}`);
    if (!plan.apply) {
      console.log("No writes were performed. Re-run with --apply only after verifying this target.");
    }
  } finally {
    await firestore.terminate();
  }
}

function requireExplicitTarget(value, name) {
  const normalized = value?.trim();
  if (!normalized) {
    throw new Error(`${name} must be explicitly set`);
  }
  if (normalized.length > 256 || /[\s/]/u.test(normalized)) {
    throw new Error(`${name} contains invalid characters`);
  }
  return normalized;
}

function isSingleFirestorePathSegment(value) {
  return (
    value.length > 0 &&
    Buffer.byteLength(value, "utf8") <= 1_500 &&
    value !== "." &&
    value !== ".." &&
    !value.includes("/") &&
    !/^__.*__$/u.test(value) &&
    !containsControlCharacter(value)
  );
}

function containsControlCharacter(value) {
  return [...value].some((character) => character.codePointAt(0) < 32);
}

function isMainModule() {
  return !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown migration failure";
    console.error(`Migration failed: ${message}`);
    process.exitCode = 1;
  });
}
