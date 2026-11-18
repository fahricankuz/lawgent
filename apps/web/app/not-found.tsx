export default function NotFound() {
  return (
    <main className="lg-main">
      <div className="lg-container">
        <div>
          <h1 className="lg-h1">Bulunamadı</h1>
          <p className="lg-meta">Bu kayıt yok ya da görme yetkiniz bulunmuyor.</p>
        </div>
        <div className="lg-actions">
          <a className="lg-btn lg-btn--secondary" href="/">Ana sayfaya dön</a>
        </div>
      </div>
    </main>
  );
}
