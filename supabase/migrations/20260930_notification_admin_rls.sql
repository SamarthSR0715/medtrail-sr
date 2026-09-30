-- Migration: 20260930_notification_admin_rls.sql
-- Description: Allow authorized admins and service_role to manage (insert/update/delete) public.championship_notifications

ALTER TABLE public.championship_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin manage notifications" ON public.championship_notifications;
CREATE POLICY "Admin manage notifications"
  ON public.championship_notifications
  FOR ALL
  TO authenticated, service_role
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
