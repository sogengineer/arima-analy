import { DatabaseConnection } from '@/database/DatabaseConnection';
import { HorseQueryRepository } from '@/repositories/queries/HorseQueryRepository';

export class ListHorses {
  private readonly connection: DatabaseConnection;
  private readonly horseRepo: HorseQueryRepository;

  constructor() {
    this.connection = new DatabaseConnection();
    this.horseRepo = new HorseQueryRepository(this.connection.getConnection());
  }

  async execute(): Promise<void> {
    try {
      console.log('🐎 登録済み出走馬一覧:');

      const horses = this.horseRepo.getAllHorsesWithDetails();

      if (horses.length === 0) {
        console.log('\n❗ まだ出走馬が登録されていません。');
        console.log('\n📥 データ入力方法:');
        console.log('1. URL取得: arima fetch-and-extract <JRA URL>');
        console.log('2. JSONインポート: arima import-url data/horse-extracted-data.json');
        return;
      }

      console.log(`\n📊 登録済み: ${horses.length}頭\n`);
      console.log('ID   馬名              生年  性別 父              調教師');
      console.log('-'.repeat(70));

      for (const horse of horses) {
        const id = (horse.id?.toString() || '-').padStart(3);
        const name = (horse.name || '').padEnd(15);
        const birthYear = (horse.birth_year?.toString() || '-').padStart(4);
        const sex = (horse.sex || '-').padEnd(3);
        const sire = (horse.sire_name || '不明').padEnd(12);
        const trainer = (horse.trainer_name || '不明').padEnd(10);

        console.log(`${id}  ${name} ${birthYear}  ${sex} ${sire} ${trainer}`);
      }

      console.log('\n💡 血統詳細: arima show-horses');

    } catch (error) {
      console.error('❌ 馬一覧の取得に失敗:', error);
    } finally {
      this.connection.close();
    }
  }
}
