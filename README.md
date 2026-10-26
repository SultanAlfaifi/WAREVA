<p align="center"><img src="brand/logos/wareva-lockup.svg" alt="WAREVA · واريفا" height="72"></p>

<h1 align="center">لا لتر بلا تحقق</h1>

**واريفا** (WAREVA: Water Reuse Validation) تتحقق من جودة مياه الوضوء والمغاسل المعالجة لحظيًا قبل أن تصل إلى ري المساحات الخضراء. لا يُفتح صمام الري إلا لماء ضمن الحدود، ويتوقف خلال ثوانٍ عند أي خلل أو انقطاع كهرباء، ويُسجَّل كل لتر وكل قرار.

الفرق عن محطات السوق ليس في المعالجة، بل في معرفة جودة كل لتر قبل أن يصل للري.

<p align="center"><a href="https://sultalfaifi.com/WAREVA/experience/"><strong>جرّب التوأم الرقمي مباشرة</strong></a> · <a href="https://sultalfaifi.com/WAREVA/">الموقع</a> · <a href="https://claude.ai/artifact/SbsbXLk3rNHajJckZuoFnW">دليل الهوية</a></p>

## أين وصلنا

| | الحالة |
|---|---|
| قواعد الأمان | تعمل ومختبرة بنفس 36 حالة في Python وJavaScript وC++ |
| التوأم الرقمي واللوحة والسجل | تعمل على الحاسوب وRaspberry Pi |
| برنامج ESP32 والبوابة | مكتوبان ومختبران برمجيًا، ولم يُشغَّلا على عتاد بعد |
| الموقع وتجربة 3D | يعملان في المتصفح والجوال |
| بحث الذكاء الاصطناعي | V8 على بيانات عامة: 117 من 399 حدثًا. طبقة مراقبة لا تفتح الري |
| النموذج المادي | الخطوة التالية: 6 أسابيع و9,500 ريال في أكاديمية الطاقة والمياه برابغ |

لم تُقس جودة ماء أو كفاءة معالجة بعد. معايير القبول في [خطة النموذج الأولي](docs/prototype-plan.md).

## جرّبه

أسرع طريقة: [التجربة الحية في المتصفح](https://sultalfaifi.com/WAREVA/experience/)، تعمل على الجوال دون تثبيت. اختر حالة مثل «ارتفاع العكارة» وراقب قرار المتحكم.

لتشغيل لوحة المتابعة والسجل على جهازك يلزم Python 3.10 أو أحدث، ولا مكتبات إضافية:

```sh
python -m dashboard.server
```

افتح <http://127.0.0.1:8787>، واختر حالة مثل «ارتفاع العكارة» أو «تعطل صمام الري»، وراقب قرار المتحكم وسببه وسجل الأحداث.

الموقع والتجربة ثلاثية الأبعاد (Node.js 22.12 أو أحدث):

```sh
npm install
npm run dev
```

## المستودع

| المجلد | ما فيه |
|---|---|
| [`core/`](core/) | قواعد الأمان: مصدر واحد للحدود والأسباب، وحالات اختبار مشتركة |
| [`twin/`](twin/) | التوأم الرقمي للوحدة |
| [`dashboard/`](dashboard/) | لوحة المتابعة والسجل |
| [`gateway/`](gateway/) | بوابة Raspberry Pi بين المتحكم واللوحة |
| [`firmware/esp32/`](firmware/esp32/) | برنامج متحكم الأمان |
| [`web/`](web/) | الموقع التعريفي وتجربة 3D |
| [`research/`](research/) | كشف الشذوذ في قراءات الحساسات |
| [`brand/`](brand/) | الهوية: الشعار والألوان والخطوط والأيقونات |
| [`docs/`](docs/) | [المنتج](docs/product.md) · [البنية](docs/architecture.md) · [قواعد الأمان](docs/safety-rules.md) · [النموذج الأولي](docs/prototype-plan.md) |

## الفريق

**سلطان الفيفي** (القائد): البرمجيات ومنطق الأمان والذكاء الاصطناعي. **فيصل الهلالي**: الميكاترونكس والتحكم والنموذج المادي. **عبدالسلام العتيبي**: المعالجة والجودة والاختبارات.

البرمجيات برخصة [MIT](LICENSE). الخطوط برخصة SIL Open Font License، ونصوصها في [`brand/fonts/`](brand/fonts/).

---

**English.** WAREVA validates treated ablution and hand-wash water in real time before it reaches landscape irrigation. A fixed-rule ESP32 safety controller opens the normally-closed irrigation valve only when every reading is present and within limits, and logs every liter and decision. This repository holds the shared safety rules (tested identically in Python, JavaScript and C++), a digital twin, the dashboard, the Raspberry Pi gateway, the ESP32 firmware, the website and the anomaly-detection research. The physical prototype is the next step; no water-quality result has been measured yet. Try it: [live digital twin](https://sultalfaifi.com/WAREVA/experience/) · [website](https://sultalfaifi.com/WAREVA/).
