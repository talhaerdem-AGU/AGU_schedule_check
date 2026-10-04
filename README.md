# AGÜ Ders Programı v8 (Hosted)

Bu sürüm 2026-2027 için AGÜ Öğrenci İşleri'nin resmi olarak yönlendirdiği `https://calendars.agu.edu.tr/timetable` kaynağını birincil kaynak olarak kullanır. `cat.agu.edu.tr/Lesson/GetLessons` yalnızca gün/saat detayları için yedek kaynaktır.

## Render
GitHub deposundaki dosyaları bu paketle değiştirin. `render.yaml` ve `Dockerfile` aynı şekilde deploy için kullanılabilir.

## Tanı
`/api/debug?code=EE3999` adresi birincil timetable kaynağında yakalanan ham kayıtları ve AJAX/JSON URL'lerini gösterir.

Not: Gerçek şube numarası hiçbir kamuya açık kaynakta yer almıyorsa uygulama bunu tahmin etmez; yanlış şubeyi göstermemek için sonuç döndürmez.
