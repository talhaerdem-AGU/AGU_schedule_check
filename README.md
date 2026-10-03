# AGÜ Ders Programı Web v6

Kullanıcı dostu hosted sürüm.

## Kullanım
Kullanıcı yalnızca web adresini açar:
1. Ders kodunu yazar (örn. `EE3999`).
2. Uygulama AGUCAT'tan mevcut şubeleri otomatik getirir.
3. Kullanıcı açılır listeden şubesini seçer.
4. İstenirse başka dersler eklenir.
5. **Programı Getir** ile haftalık tablo oluşturulur.

Tek şube varsa otomatik seçilir. Şube bilgisi kaynak veride doğrulanamazsa uygulama bunu açıkça bildirir ve rastgele/tahmini şube göstermez.

## Sunucu kurulumu
Render için `render.yaml` ve `Dockerfile` dahildir. Sunucuya bir kez deploy edildikten sonra son kullanıcı Node.js, Terminal veya Playwright başlatmaz.

## Yerel geliştirme
```bash
npm install
npx playwright install chromium
npm start
```

Ardından `http://localhost:3000`.
