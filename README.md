# AGÜ Ders Programı v7

Bu sürüm, AGUCAT kaynak verisinde gerçek şube numarası varsa doğrudan Şube 1/2/3 olarak gösterir.

AGUCAT gerçek şube numarasını yayınlamıyorsa, aynı ders koduna ait farklı programları öğretim elemanı + gün/saat bilgisine göre **Program grubu** olarak ayırır. Böylece tüm şubeler aynı anda takvime düşmez.

## Render
Repo kökünde `render.yaml` ve `Dockerfile` hazırdır. Render Blueprint ile deploy edilebilir.

## Önemli
Program grubu, gerçek şube numarası değildir; yalnız AGUCAT'ın herkese açık verisinden güvenli biçimde ayrıştırılabilen program alternatifidir. Gerçek şube numarasının gösterilebilmesi için AGÜ'nün şube bilgisini içeren bir servis/endpoint sağlaması gerekir.
