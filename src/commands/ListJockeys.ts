import { DatabaseConnection } from '@/database/DatabaseConnection';
import { JockeyQueryRepository } from '@/repositories/queries/JockeyQueryRepository';

export class ListJockeys {
  private readonly connection: DatabaseConnection;
  private readonly jockeyRepo: JockeyQueryRepository;

  constructor() {
    this.connection = new DatabaseConnection();
    this.jockeyRepo = new JockeyQueryRepository(this.connection.getConnection());
  }

  async execute(): Promise<void> {
    try {
      console.log('🏇 登録済み騎手一覧:');

      const jockeys = this.jockeyRepo.getAllJockeys();

      if (jockeys.length === 0) {
        console.log('\n❗ まだ騎手が登録されていません。');
        console.log('\n📥 騎手はレースデータのインポート時に自動登録されます。');
        console.log('  arima fetch-and-extract <JRA URL>');
        return;
      }

      console.log(`\n📊 登録済み: ${jockeys.length}人\n`);
      console.log('ID   騎手名            体重');
      console.log('-'.repeat(30));

      for (const jockey of jockeys) {
        const id = jockey.id.toString().padStart(3);
        const name = (jockey.name || '').padEnd(15);
        const weight = jockey.default_weight ? `${jockey.default_weight}kg` : '-';

        console.log(`${id}  ${name} ${weight}`);
      }

    } catch (error) {
      console.error('❌ 騎手一覧の取得に失敗:', error);
    } finally {
      this.connection.close();
    }
  }
}
