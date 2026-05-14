import { createClient } from '@supabase/supabase-js'

const SUPA_URL = 'https://frnnoxudtlvhyyoqdqzx.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZybm5veHVkdGx2aHl5b3FkcXp4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczNTY2NDUsImV4cCI6MjA5MjkzMjY0NX0.1OuqWuV-X09wEzWMp9_zjNRbWNDcSvR4TgYmu0373zE'

export const sb = createClient(SUPA_URL, SUPA_KEY, {
  auth: { detectSessionInUrl: false }
})
