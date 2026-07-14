from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from common import (
    append_jsonl,
    normalize_space,
    read_json,
    read_jsonl,
    sha256_text,
    unique_strings,
    utc_now,
    write_json,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge Azure-enriched PDF chunks into a retriever-ready knowledge base."
    )
    parser.add_argument(
        "--input",
        default="out/03_enriched_chunks/by_document",
        help="Folder containing enriched document JSONL files.",
    )
    parser.add_argument(
        "--out",
        default="out/04_knowledge_base",
        help="Knowledge-base output folder.",
    )
    parser.add_argument("--config", default="config.json", help="Pipeline configuration JSON.")
    parser.add_argument(
        "--allow-local-placeholder",
        action="store_true",
        help="Include records produced using --no-llm.",
    )
    return parser.parse_args()


def flatten_processes(processes: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []
    for process in processes or []:
        if not isinstance(process, dict):
            continue
        name = normalize_space(str(process.get("name", "")))
        if name:
            output.append(name)
        output.extend(unique_strings(process.get("steps", [])))
        output.extend(unique_strings(process.get("actors", [])))
        output.extend(unique_strings(process.get("conditions", [])))
    return output


def flatten_roles(roles: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []
    for role in roles or []:
        if not isinstance(role, dict):
            continue
        name = normalize_space(str(role.get("name", "")))
        if name:
            output.append(name)
        output.extend(unique_strings(role.get("responsibilities", [])))
    return output


def flatten_glossary(glossary: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []
    for item in glossary or []:
        if not isinstance(item, dict):
            continue
        term = normalize_space(str(item.get("term", "")))
        definition = normalize_space(str(item.get("definition", "")))
        if term or definition:
            output.append(f"{term}: {definition}".strip(": "))
    return output


def flatten_questions(items: list[dict[str, Any]]) -> list[str]:
    output: list[str] = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        question = normalize_space(str(item.get("question", "")))
        answer = normalize_space(str(item.get("answer", "")))
        if question or answer:
            output.append(f"Question: {question}\nAnswer: {answer}".strip())
    return output


def build_search_text(record: dict[str, Any]) -> str:
    knowledge = record["knowledge"]
    pieces: list[str] = [
        knowledge.get("title", ""),
        knowledge.get("topic", ""),
        *knowledge.get("subtopics", []),
        knowledge.get("document_purpose", ""),
        knowledge.get("summary", ""),
        *knowledge.get("facts", []),
        *knowledge.get("requirements", []),
        *knowledge.get("controls", []),
        *knowledge.get("systems_components", []),
        *knowledge.get("standards_references", []),
        *knowledge.get("keywords", []),
        *flatten_processes(knowledge.get("processes", [])),
        *flatten_roles(knowledge.get("roles", [])),
        *flatten_glossary(knowledge.get("glossary", [])),
        *flatten_questions(knowledge.get("questions_answered", [])),
        record["chunk"].get("source_text", ""),
    ]
    return "\n".join(unique_strings(pieces))


def infer_subdomain(knowledge: dict[str, Any]) -> str:
    candidates = (
        unique_strings([knowledge.get("topic", "")])
        + unique_strings(knowledge.get("subtopics", []))
        + unique_strings(knowledge.get("systems_components", []))
    )
    return candidates[0] if candidates else "General"


def main() -> int:
    args = parse_args()
    input_dir = Path(args.input).resolve()
    out_dir = Path(args.out).resolve()
    config = read_json(Path(args.config).resolve())

    if not input_dir.exists():
        raise SystemExit(f"Input folder does not exist: {input_dir}")

    input_files = sorted(input_dir.glob("*.jsonl"))
    if not input_files:
        raise SystemExit(f"No enriched JSONL files found in: {input_dir}")

    knowledge_records: list[dict[str, Any]] = []
    document_chunks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    relationship_records: list[dict[str, Any]] = []
    skipped_placeholders = 0
    duplicate_chunks = 0
    seen_chunk_hashes: set[str] = set()

    for input_file in input_files:
        for source_record in read_jsonl(input_file):
            generation_mode = source_record.get("generation", {}).get("mode", "")
            if generation_mode != "azure-openai" and not args.allow_local_placeholder:
                skipped_placeholders += 1
                continue

            source_text = source_record.get("chunk", {}).get("source_text", "")
            source_hash = source_record.get("chunk", {}).get("source_text_sha256") or sha256_text(source_text)
            dedupe_key = f"{source_record.get('document_id')}:{source_hash}"
            if dedupe_key in seen_chunk_hashes:
                duplicate_chunks += 1
                continue
            seen_chunk_hashes.add(dedupe_key)

            knowledge = source_record.get("knowledge", {})
            search_text = build_search_text(source_record)
            subdomain = infer_subdomain(knowledge)
            coverage = knowledge.get("evidence_quality", {}).get("coverage", "low")

            knowledge_record = {
                "schema_version": "1.0",
                "record_type": "knowledge_chunk",
                "id": source_record["chunk_id"],
                "workspace": source_record.get("workspace", config["workspace"]),
                "domain": source_record.get("domain", config["domain"]),
                "subdomain": subdomain,
                "source_collection": source_record.get(
                    "source_collection",
                    config["source_collection"],
                ),
                "title": knowledge.get("title", "") or source_record["source"]["file_name"],
                "topic": knowledge.get("topic", ""),
                "subtopics": knowledge.get("subtopics", []),
                "summary": knowledge.get("summary", ""),
                "content": source_text,
                "facts": knowledge.get("facts", []),
                "processes": knowledge.get("processes", []),
                "requirements": knowledge.get("requirements", []),
                "controls": knowledge.get("controls", []),
                "roles": knowledge.get("roles", []),
                "systems_components": knowledge.get("systems_components", []),
                "standards_references": knowledge.get("standards_references", []),
                "glossary": knowledge.get("glossary", []),
                "questions_answered": knowledge.get("questions_answered", []),
                "keywords": knowledge.get("keywords", []),
                "acronyms": knowledge.get("acronyms", []),
                "retrieval": {
                    "search_text": search_text,
                    "search_text_sha256": sha256_text(search_text),
                    "evidence_coverage": coverage,
                },
                "source": {
                    "document_id": source_record["document_id"],
                    "file_name": source_record["source"]["file_name"],
                    "relative_path": source_record["source"]["relative_path"],
                    "pdf_sha256": source_record["source"]["pdf_sha256"],
                    "page_start": source_record["source"]["page_start"],
                    "page_end": source_record["source"]["page_end"],
                    "chunk_index": source_record["chunk"]["index"],
                    "source_text_sha256": source_hash,
                },
                "lineage": {
                    "enrichment_provider": source_record.get("generation", {}).get("provider", ""),
                    "deployment": source_record.get("generation", {}).get("deployment", ""),
                    "prompt_version": source_record.get("generation", {}).get("prompt_version", ""),
                    "enriched_at": source_record.get("generation", {}).get("generated_at", ""),
                    "knowledge_built_at": utc_now(),
                },
            }
            knowledge_records.append(knowledge_record)
            document_chunks[source_record["document_id"]].append(knowledge_record)

            for index, relationship in enumerate(knowledge.get("relationships", []), start=1):
                if not isinstance(relationship, dict):
                    continue
                from_value = normalize_space(str(relationship.get("from", "")))
                to_value = normalize_space(str(relationship.get("to", "")))
                relation_type = normalize_space(str(relationship.get("type", "related_to"))).lower()
                if not from_value or not to_value:
                    continue
                relationship_records.append(
                    {
                        "schema_version": "1.0",
                        "record_type": "knowledge_relationship",
                        "id": f"{source_record['chunk_id']}-r{index:03d}",
                        "workspace": source_record.get("workspace", config["workspace"]),
                        "domain": source_record.get("domain", config["domain"]),
                        "from": from_value,
                        "to": to_value,
                        "relationship_type": relation_type,
                        "evidence": normalize_space(str(relationship.get("evidence", ""))),
                        "source": {
                            "chunk_id": source_record["chunk_id"],
                            "document_id": source_record["document_id"],
                            "file_name": source_record["source"]["file_name"],
                            "page_start": source_record["source"]["page_start"],
                            "page_end": source_record["source"]["page_end"],
                        },
                    }
                )

    knowledge_records.sort(
        key=lambda item: (
            item["source"]["file_name"].casefold(),
            item["source"]["chunk_index"],
        )
    )

    # De-duplicate relationships without losing their first supporting source.
    deduped_relationships: list[dict[str, Any]] = []
    seen_relationships: set[tuple[str, str, str]] = set()
    for record in relationship_records:
        key = (
            record["from"].casefold(),
            record["relationship_type"].casefold(),
            record["to"].casefold(),
        )
        if key in seen_relationships:
            continue
        seen_relationships.add(key)
        deduped_relationships.append(record)

    document_catalog: list[dict[str, Any]] = []
    for document_id, chunks in sorted(document_chunks.items()):
        first = chunks[0]
        all_keywords: list[str] = []
        all_topics: list[str] = []
        page_numbers: list[int] = []
        for chunk in chunks:
            all_keywords.extend(chunk["keywords"])
            all_topics.extend([chunk["topic"], *chunk["subtopics"]])
            page_numbers.extend(
                range(
                    int(chunk["source"]["page_start"]),
                    int(chunk["source"]["page_end"]) + 1,
                )
            )
        document_catalog.append(
            {
                "schema_version": "1.0",
                "record_type": "knowledge_document",
                "document_id": document_id,
                "workspace": first["workspace"],
                "domain": first["domain"],
                "source_collection": first["source_collection"],
                "file_name": first["source"]["file_name"],
                "relative_path": first["source"]["relative_path"],
                "pdf_sha256": first["source"]["pdf_sha256"],
                "page_start": min(page_numbers) if page_numbers else 0,
                "page_end": max(page_numbers) if page_numbers else 0,
                "chunk_count": len(chunks),
                "topics": unique_strings(all_topics),
                "keywords": unique_strings(all_keywords),
            }
        )

    coverage_counts = Counter(
        item["retrieval"]["evidence_coverage"] for item in knowledge_records
    )
    domain_counts = Counter(item["subdomain"] for item in knowledge_records)
    empty_summary = sum(1 for item in knowledge_records if not item["summary"])
    empty_topic = sum(1 for item in knowledge_records if not item["topic"])
    empty_questions = sum(1 for item in knowledge_records if not item["questions_answered"])

    append_jsonl(out_dir / "knowledge.jsonl", knowledge_records)
    append_jsonl(out_dir / "document_catalog.jsonl", document_catalog)
    append_jsonl(out_dir / "relationships.jsonl", deduped_relationships)

    report = {
        "schema_version": "1.0",
        "generated_at": utc_now(),
        "workspace": config["workspace"],
        "domain": config["domain"],
        "source_collection": config["source_collection"],
        "input_folder": str(input_dir),
        "input_files": len(input_files),
        "documents": len(document_catalog),
        "knowledge_records": len(knowledge_records),
        "relationships": len(deduped_relationships),
        "skipped_local_placeholders": skipped_placeholders,
        "duplicate_chunks_removed": duplicate_chunks,
        "evidence_coverage": dict(coverage_counts),
        "top_subdomains": dict(domain_counts.most_common(20)),
        "quality_checks": {
            "records_without_summary": empty_summary,
            "records_without_topic": empty_topic,
            "records_without_questions": empty_questions,
        },
        "outputs": {
            "knowledge": str(out_dir / "knowledge.jsonl"),
            "document_catalog": str(out_dir / "document_catalog.jsonl"),
            "relationships": str(out_dir / "relationships.jsonl"),
        },
    }
    write_json(out_dir / "generation_quality_report.json", report)

    manifest = {
        "schema_version": "1.0",
        "workspace": config["workspace"],
        "knowledge_file": "knowledge.jsonl",
        "document_catalog_file": "document_catalog.jsonl",
        "relationships_file": "relationships.jsonl",
        "quality_report_file": "generation_quality_report.json",
        "record_count": len(knowledge_records),
        "document_count": len(document_catalog),
        "built_at": utc_now(),
    }
    write_json(out_dir / "knowledge_manifest.json", manifest)

    print("Knowledge-base build finished.")
    print(f"Documents          : {len(document_catalog)}")
    print(f"Knowledge records  : {len(knowledge_records)}")
    print(f"Relationships      : {len(deduped_relationships)}")
    print(f"Output folder      : {out_dir}")
    print(f"Main knowledge file: {out_dir / 'knowledge.jsonl'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
