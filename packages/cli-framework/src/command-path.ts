export function getCommandPath(file: string): string[] {
	return file.replaceAll("\\", "/").split("/").slice(0, -1);
}
