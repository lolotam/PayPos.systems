import { CLOCK_DRIFT_MS, type PrivateWindowEnv } from './private-window-env';

/**
 * الساعتين الرتيبة والجدارية مقيستين مع بعض لحظة إرسال الـ PIN. لو الفرق بين تقدّمهما عدّى الحد
 * يبقى الجهاز نام أو الساعة اتغيّرت وأي موعد اتحسب بالرتيبة مبقاش يعتمد عليه. بنقارن بنقطة الإرسال مش بآخر فحص،
 * فأي نوم وقت الفتح أو بين فحصين بيتشاف في أي رد بيتطبّق، مش في الثانية الجاية بس.
 */
export class PairedClock {
  private base = { mono: 0, wall: 0 };

  constructor(private readonly env: PrivateWindowEnv) {}

  /** @returns اللحظة الرتيبة اللي اتلقط عندها الزوج، وهي نفسها لحظة إرسال الطلب */
  capture(): number {
    this.base = { mono: this.env.mono(), wall: this.env.wall() };
    return this.base.mono;
  }

  /** @returns true لو الساعتين اختلفوا أكتر من الحد من لحظة الإرسال */
  drifted(): boolean {
    const mono = this.env.mono() - this.base.mono;
    const wall = this.env.wall() - this.base.wall;
    return Math.abs(wall - mono) > CLOCK_DRIFT_MS;
  }
}
