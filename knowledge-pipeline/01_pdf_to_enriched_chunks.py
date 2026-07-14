from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from pypdf import PdfReader

from common import (
    append_jsonl,
    extract_json_object,
    file_sha256,
    normalize_space,
    read_json,
    sha256_text,
    slugify,
    unique_strings,
    utc_now,
    write_json,
)


SYSTEM_PROMPT = """
You are a knowledge-engineering assistant preparing evidence-grounded chunks for an
enterprise retrieval system.

Use ONLY the supplied PDF excerpt. Do not add outside knowledge. Do not invent missing
details. Return one valid JSON object and no explanatory prose.

Required JSON shape:
{
  "title": "short descriptive title for this excerpt",
  "topic": "primary topic",
  "subtopics": ["..."],
  "document_purpose": "purpose stated or supported by the excerpt",
  "summary": "concise evidence-grounded summary",
  "facts": ["atomic factual statement"],
  "processes": [
    {
      "name": "process name",
      "steps": ["ordered step"],
      "actors": ["role or organization"],
      "conditions": ["condition, trigger, or decision rule"]
    }
  ],
  "requirements": ["mandatory or recommended requirement"],
  "controls": ["governance, security, or operational control"],
  "roles": [
    {
      "name": "role name",
      "responsibilities": ["responsibility"]
    }
  ],
  "systems_components": ["named framework, system, component, artifact, or function"],
  "standards_references": ["explicit standard, publication, framework, or section reference"],
  "glossary": [
    {
      "term": "term or acronym",
      "definition": "definition supported by the excerpt"
    }
  ],
  "questions_answered": [
    {
      "question": "a useful question this excerpt can answer",
      "answer": "answer grounded in the excerpt"
    }
  ],
  "relationships": [
    {
      "from": "source concept",
      "to": "target concept",
      "type": "contains|supports|requires|precedes|follows|governs|maps_to|related_to",
      "evidence": "brief evidence from the excerpt, paraphrased"
    }
  ],
  "keywords": ["retrieval keyword"],
  "acronyms": [
    {
      "acronym": "ABC",
      "expansion": "full form when explicitly supported"
    }
  ],
  "evidence_quality": {
    "coverage": "high|medium|low",
    "notes": "brief explanation of gaps or ambiguity"
  }
}

Use empty arrays or an empty string when the excerpt does not support a field.
Keep answers compact. Prefer exact terminology from the source.
""".strip()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Extract PDFs, create page-aware chunks, and enrich each chunk with Azure OpenAI."
    )
    parser.add_argument("--source", required=True, help="Folder containing PDF files.")
    parser.add_argument("--out", default="out", help="Output root folder.")
    parser.add_argument("--config", default="config.json", help="Pipeline configuration JSON.")
    parser.add_argument("--force", action="store_true", help="Reprocess unchanged documents and chunks.")
    parser.add_argument("--limit", type=int, default=0, help="Process only the first N PDFs; 0 means all.")
    parser.add_argument(
        "--no-llm",
        action="store_true",
        help="Create local extracted/chunk files without calling Azure OpenAI.",
    )
    return parser.parse_args()


class AzureKnowledgeClient:
    def __init__(self, config: dict[str, Any]) -> None:
        endpoint = os.environ.get("AZURE_OPENAI_ENDPOINT", "").strip()
        api_key = os.environ.get("AZURE_OPENAI_API_KEY", "").strip()
        deployment = os.environ.get("AZURE_OPENAI_DEPLOYMENT", "").strip()
        mode = os.environ.get("AZURE_OPENAI_MODE", "v1").strip().lower()
        api_version = os.environ.get("AZURE_OPENAI_API_VERSION", "2024-10-21").strip()

        missing = [
            name
            for name, value in {
                "AZURE_OPENAI_ENDPOINT": endpoint,
                "AZURE_OPENAI_API_KEY": api_key,
                "AZURE_OPENAI_DEPLOYMENT": deployment,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError("Missing Azure OpenAI settings: " + ", ".join(missing))

        self.deployment = deployment
        self.mode = mode
        self.use_json_mode = bool(config["llm"].get("use_json_mode", True))
        self.max_retries = int(config["llm"].get("max_retries", 5))
        self.retry_base_seconds = float(config["llm"].get("retry_base_seconds", 2))
        self.request_delay_seconds = float(config["llm"].get("request_delay_seconds", 0.25))

        if mode == "v1":
            from openai import OpenAI

            self.client = OpenAI(
                api_key=api_key,
                base_url=f"{endpoint.rstrip('/')}/openai/v1/",
            )
        elif mode == "legacy":
            from openai import AzureOpenAI

            self.client = AzureOpenAI(
                api_key=api_key,
                azure_endpoint=endpoint.rstrip("/"),
                api_version=api_version,
            )
        else:
            raise ValueError("AZURE_OPENAI_MODE must be 'v1' or 'legacy'")

    def enrich(self, metadata: dict[str, Any], source_text: str) -> tuple[dict[str, Any], str]:
        user_prompt = (
            "DOCUMENT METADATA\n"
            + json.dumps(metadata, ensure_ascii=False, indent=2)
            + "\n\nPDF EXCERPT\n"
            + source_text
        )

        base_kwargs: dict[str, Any] = {
            "model": self.deployment,
            "messages": [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
        }

        last_error: Exception | None = None
        for attempt in range(1, self.max_retries + 1):
            try:
                kwargs = dict(base_kwargs)
                if self.use_json_mode:
                    kwargs["response_format"] = {"type": "json_object"}

                try:
                    response = self.client.chat.completions.create(**kwargs)
                except Exception as json_mode_error:
                    # Some older deployments do not support response_format.
                    if self.use_json_mode and (
                        "response_format" in str(json_mode_error)
                        or "json" in str(json_mode_error).lower()
                        or "unsupported" in str(json_mode_error).lower()
                    ):
                        kwargs.pop("response_format", None)
                        response = self.client.chat.completions.create(**kwargs)
                    else:
                        raise

                raw_text = response.choices[0].message.content or ""
                parsed = extract_json_object(raw_text)
                if self.request_delay_seconds > 0:
                    time.sleep(self.request_delay_seconds)
                return parsed, raw_text
            except Exception as exc:
                last_error = exc
                if attempt >= self.max_retries:
                    break
                wait_seconds = self.retry_base_seconds * (2 ** (attempt - 1))
                print(
                    f"      Azure request failed (attempt {attempt}/{self.max_retries}): "
                    f"{type(exc).__name__}: {exc}"
                )
                print(f"      Retrying after {wait_seconds:.1f}s...")
                time.sleep(wait_seconds)

        raise RuntimeError(f"Azure OpenAI request failed after retries: {last_error}") from last_error


def extract_pdf(pdf_path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    reader = PdfReader(str(pdf_path))
    pages: list[dict[str, Any]] = []
    encrypted = bool(reader.is_encrypted)

    if encrypted:
        try:
            reader.decrypt("")
        except Exception as exc:
            raise RuntimeError(f"Encrypted PDF could not be opened: {pdf_path.name}") from exc

    for index, page in enumerate(reader.pages, start=1):
        try:
            text = normalize_space(page.extract_text() or "")
            error = ""
        except Exception as exc:
            text = ""
            error = f"{type(exc).__name__}: {exc}"
        pages.append(
            {
                "page_number": index,
                "text": text,
                "char_count": len(text),
                "extraction_error": error,
            }
        )

    metadata = {
        "page_count": len(reader.pages),
        "encrypted": encrypted,
        "pdf_metadata": {
            str(key).lstrip("/"): str(value)
            for key, value in (reader.metadata or {}).items()
            if value is not None
        },
    }
    return pages, metadata


def build_page_aware_chunks(
    pages: list[dict[str, Any]],
    target_chars: int,
    overlap_chars: int,
    min_chars: int,
) -> list[dict[str, Any]]:
    stream_parts: list[str] = []
    spans: list[tuple[int, int, int]] = []
    cursor = 0

    for page in pages:
        text = page["text"].strip()
        if not text:
            continue
        marker = f"\n\n[PAGE {page['page_number']}]\n"
        part = marker + text
        start = cursor
        stream_parts.append(part)
        cursor += len(part)
        spans.append((start, cursor, int(page["page_number"])))

    stream = "".join(stream_parts).strip()
    if not stream:
        return []

    def page_for_offset(offset: int) -> int:
        for start, end, page_number in spans:
            if start <= offset < end:
                return page_number
        return spans[-1][2]

    chunks: list[dict[str, Any]] = []
    start = 0
    index = 1

    while start < len(stream):
        desired_end = min(start + target_chars, len(stream))
        end = desired_end

        if desired_end < len(stream):
            search_start = max(start + min_chars, desired_end - 1500)
            candidates = [
                stream.rfind("\n\n", search_start, desired_end),
                stream.rfind(". ", search_start, desired_end),
                stream.rfind("\n", search_start, desired_end),
                stream.rfind(" ", search_start, desired_end),
            ]
            best = max(candidates)
            if best > start + min_chars:
                end = best + (2 if stream[best:best + 2] == ". " else 0)

        chunk_text = stream[start:end].strip()
        if chunk_text:
            page_start = page_for_offset(start)
            page_end = page_for_offset(max(start, end - 1))
            chunks.append(
                {
                    "chunk_index": index,
                    "page_start": page_start,
                    "page_end": page_end,
                    "source_text": chunk_text,
                    "char_count": len(chunk_text),
                    "source_text_sha256": sha256_text(chunk_text),
                }
            )
            index += 1

        if end >= len(stream):
            break

        next_start = max(end - overlap_chars, start + 1)
        paragraph_break = stream.find("\n\n", next_start, min(end + 300, len(stream)))
        start = paragraph_break + 2 if paragraph_break >= 0 else next_start

    return chunks


def normalize_enrichment(raw: dict[str, Any]) -> dict[str, Any]:
    def list_of_dicts(name: str) -> list[dict[str, Any]]:
        value = raw.get(name, [])
        return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []

    evidence_quality = raw.get("evidence_quality", {})
    if not isinstance(evidence_quality, dict):
        evidence_quality = {}

    return {
        "title": normalize_space(str(raw.get("title", ""))),
        "topic": normalize_space(str(raw.get("topic", ""))),
        "subtopics": unique_strings(raw.get("subtopics", [])),
        "document_purpose": normalize_space(str(raw.get("document_purpose", ""))),
        "summary": normalize_space(str(raw.get("summary", ""))),
        "facts": unique_strings(raw.get("facts", [])),
        "processes": list_of_dicts("processes"),
        "requirements": unique_strings(raw.get("requirements", [])),
        "controls": unique_strings(raw.get("controls", [])),
        "roles": list_of_dicts("roles"),
        "systems_components": unique_strings(raw.get("systems_components", [])),
        "standards_references": unique_strings(raw.get("standards_references", [])),
        "glossary": list_of_dicts("glossary"),
        "questions_answered": list_of_dicts("questions_answered"),
        "relationships": list_of_dicts("relationships"),
        "keywords": unique_strings(raw.get("keywords", [])),
        "acronyms": list_of_dicts("acronyms"),
        "evidence_quality": {
            "coverage": normalize_space(str(evidence_quality.get("coverage", "low"))).lower(),
            "notes": normalize_space(str(evidence_quality.get("notes", ""))),
        },
    }


def local_placeholder(chunk: dict[str, Any], pdf_path: Path) -> dict[str, Any]:
    title = pdf_path.stem.replace("_", " ")
    return {
        "title": title,
        "topic": "",
        "subtopics": [],
        "document_purpose": "",
        "summary": "",
        "facts": [],
        "processes": [],
        "requirements": [],
        "controls": [],
        "roles": [],
        "systems_components": [],
        "standards_references": [],
        "glossary": [],
        "questions_answered": [],
        "relationships": [],
        "keywords": [],
        "acronyms": [],
        "evidence_quality": {
            "coverage": "low",
            "notes": "Created with --no-llm; enrichment is pending.",
        },
    }


def main() -> int:
    args = parse_args()
    load_dotenv()

    source_dir = Path(args.source).resolve()
    out_dir = Path(args.out).resolve()
    config_path = Path(args.config).resolve()
    config = read_json(config_path)

    if not source_dir.exists():
        print(f"Source folder not found: {source_dir}", file=sys.stderr)
        return 2

    pdf_files = sorted(source_dir.rglob("*.pdf"))
    if args.limit > 0:
        pdf_files = pdf_files[: args.limit]
    if not pdf_files:
        print(f"No PDF files found under: {source_dir}", file=sys.stderr)
        return 2

    extracted_dir = out_dir / "01_extracted_documents"
    raw_chunks_dir = out_dir / "02_raw_chunks"
    enriched_chunk_dir = out_dir / "03_enriched_chunks" / "by_chunk"
    enriched_doc_dir = out_dir / "03_enriched_chunks" / "by_document"
    raw_llm_dir = out_dir / "03_enriched_chunks" / "raw_llm_responses"
    state_path = out_dir / "state" / "processed_documents.json"
    report_path = out_dir / "reports" / "pdf_enrichment_report.json"

    state = read_json(state_path) if state_path.exists() else {"documents": {}}
    client = None if args.no_llm else AzureKnowledgeClient(config)

    target_chars = int(config["chunking"]["target_chars"])
    overlap_chars = int(config["chunking"]["overlap_chars"])
    min_chars = int(config["chunking"]["min_chars"])
    prompt_version = str(config["llm"]["prompt_version"])

    report: dict[str, Any] = {
        "schema_version": "1.0",
        "started_at": utc_now(),
        "source_folder": str(source_dir),
        "output_folder": str(out_dir),
        "documents_found": len(pdf_files),
        "documents_processed": 0,
        "documents_skipped": 0,
        "documents_failed": 0,
        "chunks_created": 0,
        "chunks_enriched": 0,
        "chunks_reused": 0,
        "failures": [],
    }

    print(f"Found {len(pdf_files)} PDF file(s).")
    for doc_number, pdf_path in enumerate(pdf_files, start=1):
        relative_path = pdf_path.relative_to(source_dir).as_posix()
        pdf_hash = file_sha256(pdf_path)
        doc_id = f"{slugify(pdf_path.stem)}-{pdf_hash[:12]}"
        combined_output_path = enriched_doc_dir / f"{doc_id}.jsonl"

        state_key = relative_path.casefold()
        previous = state["documents"].get(state_key, {})
        unchanged = (
            previous.get("pdf_sha256") == pdf_hash
            and previous.get("prompt_version") == prompt_version
            and previous.get("chunking") == config["chunking"]
            and combined_output_path.exists()
        )

        print(f"[{doc_number}/{len(pdf_files)}] {relative_path}")
        if unchanged and not args.force:
            print("    Unchanged and already complete; skipped.")
            report["documents_skipped"] += 1
            continue

        try:
            pages, pdf_metadata = extract_pdf(pdf_path)
            extracted_text_chars = sum(page["char_count"] for page in pages)
            extracted_record = {
                "schema_version": "1.0",
                "record_type": "extracted_pdf_document",
                "document_id": doc_id,
                "source": {
                    "file_name": pdf_path.name,
                    "relative_path": relative_path,
                    "absolute_path": str(pdf_path),
                    "pdf_sha256": pdf_hash,
                    "file_size_bytes": pdf_path.stat().st_size,
                },
                "metadata": pdf_metadata,
                "extraction": {
                    "extracted_at": utc_now(),
                    "total_text_chars": extracted_text_chars,
                    "pages_with_text": sum(1 for page in pages if page["text"]),
                    "pages": pages,
                },
            }
            write_json(extracted_dir / f"{doc_id}.json", extracted_record)

            chunks = build_page_aware_chunks(
                pages=pages,
                target_chars=target_chars,
                overlap_chars=overlap_chars,
                min_chars=min_chars,
            )
            if not chunks:
                raise RuntimeError("No extractable text was found. The PDF may require OCR.")

            raw_chunk_records: list[dict[str, Any]] = []
            for chunk in chunks:
                chunk_id = f"{doc_id}-c{chunk['chunk_index']:04d}"
                raw_chunk_records.append(
                    {
                        "schema_version": "1.0",
                        "record_type": "raw_pdf_chunk",
                        "chunk_id": chunk_id,
                        "document_id": doc_id,
                        "workspace": config["workspace"],
                        "domain": config["domain"],
                        "source_collection": config["source_collection"],
                        "source": {
                            "file_name": pdf_path.name,
                            "relative_path": relative_path,
                            "pdf_sha256": pdf_hash,
                            "page_start": chunk["page_start"],
                            "page_end": chunk["page_end"],
                        },
                        "chunk": {
                            "index": chunk["chunk_index"],
                            "char_count": chunk["char_count"],
                            "source_text_sha256": chunk["source_text_sha256"],
                            "source_text": chunk["source_text"],
                        },
                    }
                )
            append_jsonl(raw_chunks_dir / f"{doc_id}.jsonl", raw_chunk_records)
            report["chunks_created"] += len(raw_chunk_records)

            enriched_records: list[dict[str, Any]] = []
            for chunk_position, raw_chunk in enumerate(raw_chunk_records, start=1):
                chunk_id = raw_chunk["chunk_id"]
                cache_path = enriched_chunk_dir / f"{chunk_id}.json"

                cache_is_valid = False
                if cache_path.exists() and not args.force:
                    cached = read_json(cache_path)
                    cache_is_valid = (
                        cached.get("source", {}).get("pdf_sha256") == pdf_hash
                        and cached.get("chunk", {}).get("source_text_sha256")
                        == raw_chunk["chunk"]["source_text_sha256"]
                        and cached.get("generation", {}).get("prompt_version") == prompt_version
                        and (
                            args.no_llm
                            or cached.get("generation", {}).get("mode") == "azure-openai"
                        )
                    )
                    if cache_is_valid:
                        enriched_records.append(cached)
                        report["chunks_reused"] += 1
                        print(
                            f"    Chunk {chunk_position}/{len(raw_chunk_records)} "
                            f"{chunk_id}: reused"
                        )
                        continue

                print(
                    f"    Chunk {chunk_position}/{len(raw_chunk_records)} "
                    f"{chunk_id}: {'local only' if args.no_llm else 'sending to Azure OpenAI'}"
                )

                metadata_for_llm = {
                    "workspace": config["workspace"],
                    "domain": config["domain"],
                    "source_collection": config["source_collection"],
                    "file_name": pdf_path.name,
                    "page_start": raw_chunk["source"]["page_start"],
                    "page_end": raw_chunk["source"]["page_end"],
                    "chunk_id": chunk_id,
                }

                if args.no_llm:
                    normalized = local_placeholder(raw_chunk["chunk"], pdf_path)
                    raw_response = ""
                    generation_mode = "local-no-llm"
                    deployment = ""
                else:
                    assert client is not None
                    raw_result, raw_response = client.enrich(
                        metadata=metadata_for_llm,
                        source_text=raw_chunk["chunk"]["source_text"],
                    )
                    normalized = normalize_enrichment(raw_result)
                    generation_mode = "azure-openai"
                    deployment = client.deployment
                    raw_llm_dir.mkdir(parents=True, exist_ok=True)
                    (raw_llm_dir / f"{chunk_id}.txt").write_text(
                        raw_response,
                        encoding="utf-8",
                    )
                    report["chunks_enriched"] += 1

                enriched_record = {
                    "schema_version": "1.0",
                    "record_type": "enriched_pdf_chunk",
                    "chunk_id": chunk_id,
                    "document_id": doc_id,
                    "workspace": config["workspace"],
                    "domain": config["domain"],
                    "source_collection": config["source_collection"],
                    "source": raw_chunk["source"],
                    "chunk": raw_chunk["chunk"],
                    "knowledge": normalized,
                    "generation": {
                        "mode": generation_mode,
                        "provider": "Azure OpenAI" if not args.no_llm else "none",
                        "deployment": deployment,
                        "prompt_version": prompt_version,
                        "generated_at": utc_now(),
                    },
                }
                write_json(cache_path, enriched_record)
                enriched_records.append(enriched_record)

            append_jsonl(combined_output_path, enriched_records)

            state["documents"][state_key] = {
                "relative_path": relative_path,
                "document_id": doc_id,
                "pdf_sha256": pdf_hash,
                "prompt_version": prompt_version,
                "chunking": config["chunking"],
                "chunk_count": len(enriched_records),
                "combined_output": str(combined_output_path),
                "completed_at": utc_now(),
                "mode": "local-no-llm" if args.no_llm else "azure-openai",
            }
            write_json(state_path, state)

            report["documents_processed"] += 1
            print(f"    Completed: {len(enriched_records)} chunk(s).")
        except Exception as exc:
            report["documents_failed"] += 1
            report["failures"].append(
                {
                    "file": relative_path,
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                }
            )
            print(f"    FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)

    report["completed_at"] = utc_now()
    write_json(report_path, report)

    print("\nPDF enrichment finished.")
    print(f"Processed documents : {report['documents_processed']}")
    print(f"Skipped documents   : {report['documents_skipped']}")
    print(f"Failed documents    : {report['documents_failed']}")
    print(f"Created chunks      : {report['chunks_created']}")
    print(f"Azure-enriched      : {report['chunks_enriched']}")
    print(f"Reused chunks       : {report['chunks_reused']}")
    print(f"Report              : {report_path}")

    return 1 if report["documents_failed"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
