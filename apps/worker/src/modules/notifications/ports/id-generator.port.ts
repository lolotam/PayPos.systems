export interface IdGenerator {
  /** يولد UUID v7 للمحاولة والتنفيذ والأحداث دون عشوائية داخل قواعد العمل. */
  newId(): string;
}
