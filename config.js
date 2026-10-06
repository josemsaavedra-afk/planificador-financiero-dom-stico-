// Public staging configuration only. Never put private credentials here.
// The distributed default has no backend and cannot activate Treasury persistence.
window.DOMUS_CONFIG = window.DOMUS_CONFIG || Object.freeze({
  supabaseUrl: '',
  supabasePublishableKey: '',
  treasuryPersistence: false
});
