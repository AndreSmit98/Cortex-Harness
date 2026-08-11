import { useState } from 'react';
import { FolderOpen } from 'lucide-react';
import { Button, Input, Label, Spinner, useToastContext } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { canSelectLocalFolder, selectLocalFolder } from '~/utils';

type WorkspacePathInputProps = {
  id: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
};

export default function WorkspacePathInput({
  id,
  value,
  onChange,
  disabled = false,
}: WorkspacePathInputProps) {
  const localize = useLocalize();
  const { showToast } = useToastContext();
  const [isChoosing, setIsChoosing] = useState(false);
  const hasNativePicker = canSelectLocalFolder();

  const chooseFolder = async () => {
    if (isChoosing || disabled) {
      return;
    }

    setIsChoosing(true);
    try {
      const selectedPath = await selectLocalFolder(value);
      if (selectedPath) {
        onChange(selectedPath);
      }
    } catch {
      showToast({
        message: localize('com_ui_choose_folder_error'),
        status: 'error',
      });
    } finally {
      setIsChoosing(false);
    }
  };

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-sm font-medium text-text-primary">
        {localize('com_ui_project_workspace')}
      </Label>
      <div className="flex items-center gap-2">
        <Input
          id={id}
          value={value}
          disabled={disabled || isChoosing}
          onChange={(event) => onChange(event.target.value)}
          placeholder={localize('com_ui_project_workspace_placeholder')}
          className="min-w-0 flex-1 bg-transparent font-mono text-text-primary placeholder:text-text-secondary focus-visible:ring-2 focus-visible:ring-ring-primary"
        />
        {hasNativePicker ? (
          <Button
            type="button"
            variant="outline"
            onClick={chooseFolder}
            disabled={disabled || isChoosing}
            className="shrink-0"
          >
            {isChoosing ? (
              <Spinner className="size-4" />
            ) : (
              <FolderOpen className="size-4" aria-hidden="true" />
            )}
            {localize('com_ui_choose_folder')}
          </Button>
        ) : null}
      </div>
      <p className="text-xs text-text-secondary">
        {localize('com_ui_project_workspace_hint')}
      </p>
    </div>
  );
}
