alter table franchisee_agreements add column if not exists boldsign_document_id text;
create index if not exists franchisee_agreements_boldsign_doc_idx on franchisee_agreements(boldsign_document_id);
