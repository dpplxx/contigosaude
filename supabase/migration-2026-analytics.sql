-- Rastreamento de eventos de usuário (analytics)
-- Registra cliques, buscas, visualizações, etc

CREATE TABLE analytics_events (
  id bigserial PRIMARY KEY,
  event_type text NOT NULL,
  user_id uuid,
  session_id text,
  data jsonb DEFAULT '{}',
  created_at timestamp with time zone DEFAULT now(),

  CONSTRAINT valid_event_type CHECK (event_type IN (
    'page_view',
    'search_performed',
    'location_searched',
    'specialty_searched',
    'search_no_results',
    'professional_appeared_in_results',
    'profile_opened',
    'whatsapp_clicked',
    'profile_shared',
    'signup_started',
    'signup_completed'
  ))
);

CREATE INDEX idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX idx_analytics_user_id ON analytics_events(user_id);
CREATE INDEX idx_analytics_created_at ON analytics_events(created_at DESC);

-- RPC pública pra registrar eventos (sem requer auth, só pra telemetria)
CREATE OR REPLACE FUNCTION hc_registrar_evento(
  p_event_type text,
  p_user_id uuid DEFAULT NULL,
  p_session_id text DEFAULT NULL,
  p_data jsonb DEFAULT '{}'::jsonb
) RETURNS void AS $$
BEGIN
  INSERT INTO analytics_events (event_type, user_id, session_id, data)
  VALUES (p_event_type, p_user_id, p_session_id, p_data);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Policy pública: qualquer um pode inserir eventos (telemetria)
ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Qualquer um registra evento" ON analytics_events
  FOR INSERT WITH CHECK (true);

-- Admins podem ler todos os eventos
CREATE POLICY "Admin lê eventos" ON analytics_events
  FOR SELECT USING (EXISTS(SELECT 1 FROM admins WHERE user_id = auth.uid()));
