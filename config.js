// ===== ตั้งค่าการเชื่อมต่อ Supabase =====
// Supabase Dashboard > Project Settings > API
//   SUPABASE_URL      = Project URL
//   SUPABASE_ANON_KEY = anon / publishable key   (ห้ามใช้ service_role key เด็ดขาด)
// ค่า anon key เป็นกุญแจสาธารณะ ใส่ใน GitHub ได้ เพราะข้อมูลถูกป้องกันด้วย RLS ใน schema.sql
window.PMG_CONFIG = {
  SUPABASE_URL: "https://xicaxfnoivrwkicnedom.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable_9VsBycOnRWHzOQtXmrokcg_oO3BMAJi"
};
