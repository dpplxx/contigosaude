import { supabase } from "./supabase";

let sessionId = null;

export function initSession() {
  if (!sessionId) {
    sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return sessionId;
}

export async function trackEvent(eventType, data = {}) {
  if (!sessionId) initSession();

  try {
    const { data: user } = await supabase.auth.getUser();
    await supabase.rpc("hc_registrar_evento", {
      p_event_type: eventType,
      p_user_id: user?.user?.id || null,
      p_session_id: sessionId,
      p_data: data,
    });
  } catch (error) {
    // Falha silenciosa - eventos de analytics não devem quebrar o app
    console.error(`[Analytics] Falha ao rastrear ${eventType}:`, error.message);
  }
}

export const Events = {
  PAGE_VIEW: "page_view",
  SEARCH_PERFORMED: "search_performed",
  LOCATION_SEARCHED: "location_searched",
  SPECIALTY_SEARCHED: "specialty_searched",
  SEARCH_NO_RESULTS: "search_no_results",
  PROFESSIONAL_APPEARED: "professional_appeared_in_results",
  PROFILE_OPENED: "profile_opened",
  WHATSAPP_CLICKED: "whatsapp_clicked",
  PROFILE_SHARED: "profile_shared",
  SIGNUP_STARTED: "signup_started",
  SIGNUP_COMPLETED: "signup_completed",
  REVIEW_SUBMITTED: "review_submitted",
};
