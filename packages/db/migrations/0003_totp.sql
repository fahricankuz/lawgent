-- İki aşamalı doğrulama: kullanıcı yalnızca kendi TOTP ayarını okur/yazar.
CREATE FUNCTION auth.get_own_totp() RETURNS TABLE (totp_secret_enc bytea, totp_enabled boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT totp_secret_enc, totp_enabled FROM users WHERE id = app.uid()
$$;

CREATE FUNCTION auth.set_own_totp(p_secret_enc bytea, p_enabled boolean) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF app.uid() IS NULL THEN RAISE EXCEPTION 'Kullanıcı bağlamı yok' USING ERRCODE = '42501'; END IF;
  UPDATE users SET totp_secret_enc = p_secret_enc, totp_enabled = p_enabled WHERE id = app.uid();
END $$;

-- Parola değişince/hesap kapanınca tüm oturumlar düşer.
CREATE FUNCTION auth.revoke_user_sessions(p_user uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  UPDATE sessions SET revoked_at = now()
  WHERE user_id = p_user AND revoked_at IS NULL AND (p_user = app.uid() OR app.is_tenant_admin())
$$;

REVOKE ALL ON FUNCTION auth.get_own_totp(), auth.set_own_totp(bytea, boolean), auth.revoke_user_sessions(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION auth.get_own_totp(), auth.set_own_totp(bytea, boolean), auth.revoke_user_sessions(uuid) TO lawgent_app;

-- Sohbete dahil belgeler değiştirilebilir.
GRANT DELETE ON chat_thread_documents TO lawgent_app;
CREATE POLICY thread_docs_delete ON chat_thread_documents FOR DELETE TO lawgent_app
  USING (tenant_id = app.tid() AND app.can_access_matter(matter_id));
