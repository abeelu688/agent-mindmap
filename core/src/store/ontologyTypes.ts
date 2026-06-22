// The canonical ontology-record types live in `@agent-mindmap/shared` so the
// `Store` interface (`Store.readOntologyRecord` / `Store.writeOntologyRecord`)
// and both store implementations can share one type. Re-exported here under
// the historical names so existing extension import paths (`from "./ontologyTypes"`)
// keep working without touching every call site.
export type {
  OntologyRecord as ConceptOntologyRecord,
  OntologyRecordNode as ConceptNode,
  OntologyRecordMapping as ConceptMapping,
  OntologyRecordTopicPath as TopicConceptPathDecision,
  ReattachMove,
} from "@agent-mindmap/shared";
