-- Т2.9: advisory causal findings share continuity evidence, statuses and review.
ALTER TABLE continuity_issues DROP CONSTRAINT continuity_issues_kind_check;
ALTER TABLE continuity_issues ADD CONSTRAINT continuity_issues_kind_check
  CHECK (kind IN ('object', 'knowledge', 'place', 'age', 'time', 'causality'));
