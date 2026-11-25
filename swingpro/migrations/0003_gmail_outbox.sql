-- Gmail-Versand: atomares Beanspruchen und Zeitpunkt des Versandversuchs
ALTER TABLE outbox ADD COLUMN sending_at INTEGER;
