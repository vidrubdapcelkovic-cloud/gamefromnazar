const MENU_DEPTH = 100;

class MenuScene extends Phaser.Scene {
  constructor() {
    super('MenuScene');
  }

  init(data) {
    this.initialMessage = data && typeof data.message === 'string' ? data.message : '';
  }

  create() {
    this.cleanupDone = false;
    this.transitionLocked = false;
    this.modalAction = null;
    this.slotManager = new SaveSlotManager();
    const migration = this.slotManager.migrateLegacySave();

    this.add.rectangle(480, 270, 960, 540, 0x202a32);
    this.add.rectangle(480, 270, 900, 480, 0x111820, 0.96)
      .setStrokeStyle(3, 0x7da2b8, 0.8);
    this.add.text(480, 54, 'Nazar Survival', {
      fontFamily: 'Arial, sans-serif', fontSize: '34px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    this.add.text(480, 91, 'Выберите слот сохранения', {
      fontFamily: 'Arial, sans-serif', fontSize: '19px', color: '#bde6ff'
    }).setOrigin(0.5);

    this.slotCards = [this.createSlotCard(1, 270), this.createSlotCard(2, 690)];
    this.messageText = this.add.text(480, 493, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', color: '#ffd59b',
      align: 'center', wordWrap: { width: 820 }
    }).setOrigin(0.5);

    this.createConfirmationModal();
    this.refreshSlots();
    if (!migration.success) this.showMessage('Не удалось проверить старое сохранение: хранилище недоступно.');
    else if (migration.migrated) this.showMessage('Старое сохранение перенесено в слот 1.');
    else if (this.initialMessage) this.showMessage(this.initialMessage);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.once(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
  }

  createSlotCard(slotId, x) {
    const background = this.add.rectangle(x, 280, 360, 320, 0x253441, 0.95)
      .setStrokeStyle(3, 0x6f93a8, 0.8);
    const title = this.add.text(x, 145, `СЛОТ ${slotId}`, {
      fontFamily: 'Arial, sans-serif', fontSize: '25px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    const status = this.add.text(x, 192, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '18px', fontStyle: 'bold', color: '#dcecf5'
    }).setOrigin(0.5);
    const summary = this.add.text(x, 230, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '17px', color: '#bde6ff', align: 'center'
    }).setOrigin(0.5);
    const continueControl = this.createButton(x, 286, 250, 46, 'ПРОДОЛЖИТЬ', () => this.continueSlot(slotId));
    const newControl = this.createButton(x, 342, 250, 46, 'НОВАЯ ИГРА', () => this.requestNewGame(slotId));
    const resetControl = this.createButton(x, 398, 250, 38, 'СБРОСИТЬ СЛОТ', () => this.requestReset(slotId), 0x64383d);
    return { slotId, background, title, status, summary, continueControl, newControl, resetControl, state: null };
  }

  createButton(x, y, width, height, label, action, color = 0x365b72) {
    const button = this.add.rectangle(x, y, width, height, color, 0.95)
      .setStrokeStyle(2, 0xcbe9ff, 0.8)
      .setInteractive({ useHandCursor: true });
    const text = this.add.text(x, y, label, {
      fontFamily: 'Arial, sans-serif', fontSize: '15px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5);
    const handler = (pointer, localX, localY, event) => {
      if (event && event.stopPropagation) event.stopPropagation();
      if (!this.transitionLocked && !this.modalAction) action();
    };
    button.on('pointerdown', handler);
    return { button, text, handler };
  }

  setControlEnabled(control, enabled) {
    control.button.setVisible(enabled);
    control.text.setVisible(enabled);
    if (enabled) control.button.setInteractive({ useHandCursor: true });
    else control.button.disableInteractive();
  }

  refreshSlots() {
    this.slotCards.forEach((card) => {
      card.state = this.slotManager.inspectSlot(card.slotId);
      const valid = card.state.status === 'VALID';
      const empty = card.state.status === 'EMPTY';
      const corrupt = card.state.status === 'CORRUPT';
      card.status.setText(valid ? 'СОХРАНЕНИЕ' : empty ? 'ПУСТОЙ СЛОТ' : corrupt ? 'СОХРАНЕНИЕ ПОВРЕЖДЕНО' : 'ОШИБКА');
      card.status.setColor(valid ? '#9ee8a7' : empty ? '#dcecf5' : '#ff9b9b');
      card.summary.setText(valid ? card.state.summary : corrupt ? 'Слот нужно сбросить' : empty ? 'Начните новую игру' : 'Хранилище недоступно');
      this.setControlEnabled(card.continueControl, valid);
      this.setControlEnabled(card.newControl, empty || valid);
      this.setControlEnabled(card.resetControl, valid || corrupt);
    });
  }

  continueSlot(slotId) {
    const state = this.slotManager.inspectSlot(slotId);
    if (state.status !== 'VALID') {
      this.refreshSlots();
      this.showMessage(state.status === 'CORRUPT' ? 'Сохранение повреждено.' : 'В этом слоте нет сохранения.');
      return;
    }
    this.startGame(slotId, 'continue');
  }

  requestNewGame(slotId) {
    const state = this.slotManager.inspectSlot(slotId);
    if (state.status === 'EMPTY') {
      this.startGame(slotId, 'new');
      return;
    }
    if (state.status === 'VALID') {
      this.openModal(`Начать новую игру в слоте ${slotId}? Текущее сохранение будет удалено.`, () => {
        const deleted = this.slotManager.delete(slotId);
        if (!deleted.success) {
          this.closeModal();
          this.showMessage('Не удалось очистить слот: хранилище недоступно.');
          return;
        }
        this.startGame(slotId, 'new');
      }, 'НАЧАТЬ ЗАНОВО');
      return;
    }
    this.refreshSlots();
    this.showMessage('Повреждённый слот сначала нужно сбросить.');
  }

  requestReset(slotId) {
    this.openModal(`Удалить сохранение из слота ${slotId}?`, () => {
      const result = this.slotManager.delete(slotId);
      this.closeModal();
      this.refreshSlots();
      this.showMessage(result.success ? `Слот ${slotId} очищен.` : 'Не удалось очистить слот: хранилище недоступно.');
    }, 'УДАЛИТЬ');
  }

  startGame(slotId, mode) {
    if (this.transitionLocked) return;
    this.transitionLocked = true;
    this.scene.start('GameScene', { slotId, mode });
  }

  createConfirmationModal() {
    const depth = MENU_DEPTH;
    this.modalOverlay = this.add.rectangle(480, 270, 960, 540, 0x000000, 0.72)
      .setDepth(depth).setVisible(false);
    this.modalPanel = this.add.rectangle(480, 270, 540, 220, 0x17232d, 1)
      .setStrokeStyle(3, 0xbad5e8, 0.9).setDepth(depth + 1).setVisible(false);
    this.modalText = this.add.text(480, 228, '', {
      fontFamily: 'Arial, sans-serif', fontSize: '22px', fontStyle: 'bold', color: '#ffffff',
      align: 'center', wordWrap: { width: 470 }
    }).setOrigin(0.5).setDepth(depth + 2).setVisible(false);
    this.confirmButton = this.add.rectangle(390, 326, 150, 44, 0x3d7651, 1)
      .setStrokeStyle(2, 0xcbe9ff, 0.85).setDepth(depth + 2).setVisible(false);
    this.confirmText = this.add.text(390, 326, 'ПОДТВЕРДИТЬ', {
      fontFamily: 'Arial, sans-serif', fontSize: '17px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setDepth(depth + 3).setVisible(false);
    this.cancelButton = this.add.rectangle(570, 326, 150, 44, 0x5d3e43, 1)
      .setStrokeStyle(2, 0xcbe9ff, 0.85).setDepth(depth + 2).setVisible(false);
    this.cancelText = this.add.text(570, 326, 'ОТМЕНА', {
      fontFamily: 'Arial, sans-serif', fontSize: '16px', fontStyle: 'bold', color: '#ffffff'
    }).setOrigin(0.5).setDepth(depth + 3).setVisible(false);
    this.onConfirm = () => { if (this.modalAction) this.modalAction(); };
    this.onCancel = () => this.closeModal();
    this.confirmButton.on('pointerdown', this.onConfirm);
    this.cancelButton.on('pointerdown', this.onCancel);
  }

  openModal(message, action, confirmLabel) {
    this.modalAction = action;
    this.modalText.setText(message);
    this.confirmText.setText(confirmLabel || 'ПОДТВЕРДИТЬ');
    this.modalOverlay.setInteractive();
    this.confirmButton.setInteractive({ useHandCursor: true });
    this.cancelButton.setInteractive({ useHandCursor: true });
    [this.modalOverlay, this.modalPanel, this.modalText, this.confirmButton, this.confirmText, this.cancelButton, this.cancelText]
      .forEach((element) => element.setVisible(true));
  }

  closeModal() {
    this.modalAction = null;
    this.modalOverlay.disableInteractive();
    this.confirmButton.disableInteractive();
    this.cancelButton.disableInteractive();
    [this.modalOverlay, this.modalPanel, this.modalText, this.confirmButton, this.confirmText, this.cancelButton, this.cancelText]
      .forEach((element) => element.setVisible(false));
  }

  showMessage(message) {
    this.messageText.setText(message || '');
  }

  cleanup() {
    if (this.cleanupDone) return;
    this.cleanupDone = true;
    this.slotCards.forEach((card) => {
      [card.continueControl, card.newControl, card.resetControl].forEach((control) => {
        control.button.off('pointerdown', control.handler);
      });
    });
    this.confirmButton.off('pointerdown', this.onConfirm);
    this.cancelButton.off('pointerdown', this.onCancel);
    this.events.off(Phaser.Scenes.Events.SHUTDOWN, this.cleanup, this);
    this.events.off(Phaser.Scenes.Events.DESTROY, this.cleanup, this);
    this.modalAction = null;
    this.slotCards = [];
  }
}
